import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import {
  CheckCircleFill,
  PlusCircle,
  FileEarmarkText,
  GraphUp,
  InfoCircle,
  PinMap,
  PinMapFill,
  Table,
} from "react-bootstrap-icons";
import GriddapDetails from "../GriddapDetails/GriddapDetails.jsx";
import DatasetMetadata, {
  Citation,
  DatasetAbstract,
  KeywordsCell,
  LicenseCell,
  MetadataExtentCells,
  NoTranslationNote,
  Organizations,
  SourceLinksCell,
} from "../DatasetMetadata/DatasetMetadata.jsx";
import useDatasetMetadata from "../DatasetMetadata/useDatasetMetadata.js";
import TaxonomyChart from "../TaxonomyChart/TaxonomyChart.jsx";
import TimeDistribution from "../TimeDistribution/TimeDistribution.jsx";
import { server } from "../../../config";
import reportError from "../../../state/reportError.js";
import { useActivityTask } from "../../../state/activity/ActivityProvider.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { TAB_PARAM } from "../../../state/selection/previewParams.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import {
  dataLayerKeyForDataset,
  DATA_LAYER_LABEL_KEYS,
  TRAJECTORY_TYPE_KEYS,
} from "../../../state/dataLayers.js";
import { gridNodeFactors, totalGridNodes } from "../../../wmsUtilities";
import {
  formatInstant,
  formatInstantRange,
  formatRange,
} from "../../../utilities.jsx";
import CardList from "./CardList.jsx";
import { DatasetPlatformIcon } from "../DatasetsTable/DatasetCard.jsx";
import ListCard, {
  CardField,
  CardTags,
  ListCardSkeleton,
  useExpandableList,
} from "./ListCard.jsx";
import useTrajectoryPasses from "./useTrajectoryPasses.js";
import { SkeletonGroup } from "../../ui/Skeleton.jsx";
import Tooltip from "../../ui/Tooltip.jsx";
import ZoomToDataset, {
  useZoomToDataset,
} from "../../AppShell/ZoomToDataset/ZoomToDataset.jsx";
import "./styles.css";

function GridNodeCount({ dimensions }) {
  const factors = gridNodeFactors(dimensions);
  const total = totalGridNodes(dimensions);
  if (!factors.length) return total?.toLocaleString() ?? null;

  return (
    <span className="gridNodeCount">
      <span className="gridNodeFactors">
        {factors.map((dim, index) => (
          <React.Fragment key={dim.name}>
            {index > 0 && <span className="gridNodeOperator">×</span>}
            <span className="gridNodeFactor" title={dim.name}>
              <span className="gridNodeFactorValue">
                {dim.n_values.toLocaleString()}
              </span>
              <span className="gridNodeFactorName">{dim.name}</span>
            </span>
          </React.Fragment>
        ))}
      </span>
    </span>
  );
}

// The record list returns every role under `profile_id` (shapeQuery.js
// coalesces them), so the role can only be named from the dataset's own
// cf_role variables.
const CF_ROLE_LABELS = {
  timeseries_id: "cfRoleTimeseriesIdText",
  profile_id: "cfRoleProfileIdText",
  trajectory_id: "cfRoleTrajectoryIdText",
};

function cfRoleColumn(dataset, roleOrder, t) {
  const variableFor = {
    timeseries_id: dataset.timeseries_id_variable,
    profile_id: dataset.profile_id_variable,
    trajectory_id: dataset.trajectory_id_variable,
  };
  // '' (the harvester's sentinel) and NULL both mean "no such role".
  const role = roleOrder.find((r) => variableFor[r]);
  return {
    label: role ? t(CF_ROLE_LABELS[role]) : t("datasetInspectorRecordIDText"),
    variable: role ? variableFor[role] : undefined,
  };
}

function IdCaption({ label, variable }) {
  return (
    <span className="recordIdCaption">
      {label}
      {variable && <code className="recordIdVariable">{variable}</code>}
    </span>
  );
}

const EOV_VISIBLE_LIMIT = 3;

// Stable identity so CardList's sort memo is not rebuilt on every render of
// this page.
const recordKeyOf = (row) => row.profile_id;

const formatPass = ({ start, end }) =>
  start === end ? start : `${start} → ${end}`;

// Condensed: a ship on a regular route can cross the same hex hundreds of times.
function PassButtons({ recordId, passes, onPlot }) {
  const { t } = useTranslation();
  const { shown, hidden, expanded, toggle } = useExpandableList(passes, 3);
  return (
    <span className="passButtons">
      {shown.map((pass) => {
        const label = t("datasetInspectorPlotPassTitle", {
          id: recordId,
          start: pass.start,
          end: pass.end,
        });
        return (
          <button
            key={pass.start}
            type="button"
            className="listCardButton"
            title={label}
            aria-label={label}
            onClick={() => onPlot(pass)}
          >
            <GraphUp size={13} aria-hidden="true" />
            {formatPass(pass)}
          </button>
        );
      })}
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          className="listCardTagsMore"
          onClick={toggle}
          aria-expanded={expanded}
        >
          {expanded ? t("listCardTagsFewerText") : `+${hidden}`}
        </button>
      )}
    </span>
  );
}

export default function DatasetInspector({
  dataset,
  returnToList,
  setHoveredDataset,
  setInspectRecordID,
  query,
  selectedTrajectory,
  setSelectedTrajectory,
  // {datasetPk, profileId} from a map marker click: pinned to the top of the
  // record list rather than opening its preview outright.
  highlightedRecord,
  setHighlightedRecord,
  activeWmsOverlay,
  setActiveWmsOverlay,
}) {
  const { t, i18n } = useTranslation();
  const { zoomToDataset } = useZoomToDataset();
  const { eovsSelected } = useFilters();
  const {
    handleSelectDataset,
    selectedPks,
    mappedRecord,
    setMappedRecord,
    inspectDatasetExcluded,
  } = useSelection();
  const { offerTip, tipHighlight } = useTips();
  const isTrajectory = TRAJECTORY_TYPE_KEYS.some(
    ([, type]) => type === dataset.cdm_data_type,
  );
  const isRealtime = Boolean(dataset.is_realtime);
  const metadata = useDatasetMetadata(dataset.pk);
  const [datasetRecords, setDatasetRecords] = useState();
  const [recordsError, setRecordsError] = useState(false);
  const [recordsAttempt, setRecordsAttempt] = useState(0);
  const inspectorRef = useRef(null);
  const isGrid = dataset.cdm_data_type === "Grid";
  // Reuses the "Dataset geometry" layer filter's key so the labels match.
  const geometryKey = dataLayerKeyForDataset(dataset);
  const geometryLabel = geometryKey
    ? t(DATA_LAYER_LABEL_KEYS[geometryKey])
    : dataset.cdm_data_type;
  const hasRecordList = dataset.source_type !== "obis" && !isGrid;
  useEffect(
    () =>
      offerTip([
        ...(isTrajectory ? ["trajectory"] : []),
        ...(isRealtime ? ["realtime"] : []),
        ...(hasRecordList ? ["showData"] : []),
      ]),
    [offerTip, isTrajectory, isRealtime, hasRecordList],
  );
  // Starting false would paint one frame of an empty table before the effect
  // fires the fetch.
  const [loading, setLoading] = useState(hasRecordList);
  useActivityTask("activityRecordListText", loading);

  const isTrajectoryDataset =
    dataset.source_type !== "obis" &&
    (dataset.cdm_data_type || "").includes("Trajectory");

  const { featureQuery } = useMapState();
  const clickedArea =
    selectedTrajectory?.datasetPk === dataset.pk && selectedTrajectory.area
      ? selectedTrajectory.area
      : featureQuery?.lngLat && featureQuery.buckets
        ? { lngLat: featureQuery.lngLat, z: featureQuery.buckets.z }
        : undefined;
  const passes = useTrajectoryPasses(
    isTrajectoryDataset ? dataset.pk : undefined,
    query,
    clickedArea,
  );

  useEffect(() => {
    if (!hasRecordList) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const queryParams = new URLSearchParams(query);
    queryParams.set("datasetPKs", dataset.pk);

    fetch(`${server}/datasetRecordsList?${queryParams.toString()}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`datasetRecordsList failed: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDatasetRecords(data);
        setRecordsError(false);
      })
      .catch((error) => {
        // An empty table would read as "this dataset has no records".
        reportError("datasetRecordsList fetch failed", error);
        if (!cancelled) setRecordsError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `query` omitted on purpose: refetching the whole list on every filter
    // change is too costly; reopening the page refreshes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, hasRecordList, recordsAttempt]);

  useEffect(() => {
    const typingIn = (target) =>
      target instanceof Element &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

    const onKeyDown = (e) => {
      if (e.key !== "Backspace" || typingIn(e.target)) return;
      e.preventDefault();
      returnToList();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [returnToList]);

  // Swipe left (touch, trackpad, or horizontal wheel) returns to the list.
  useEffect(() => {
    const el = inspectorRef.current;
    if (!el) return undefined;

    const SWIPE_THRESHOLD = 70; // px of leftward travel to count as a swipe

    let touchStartX = 0;
    let touchStartY = 0;

    const onTouchStart = (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };
    const onTouchEnd = (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (dx > -SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      returnToList();
    };

    let wheelAccumX = 0;
    let wheelTimer = null;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      wheelAccumX += e.deltaX;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelAccumX = 0;
      }, 150);
      if (wheelAccumX <= -SWIPE_THRESHOLD) {
        wheelAccumX = 0;
        returnToList();
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, [returnToList]);

  const recordIdField = cfRoleColumn(
    dataset,
    isTrajectoryDataset
      ? ["trajectory_id", "profile_id", "timeseries_id"]
      : ["profile_id", "timeseries_id", "trajectory_id"],
    t,
  );

  const recordSortFields = useMemo(
    () => [
      {
        id: "id",
        label: recordIdField.label,
        type: "string",
        value: (row) => row.profile_id,
      },
      {
        id: "timeMin",
        label: t("timeSelectorStartDate"),
        type: "string",
        value: (row) => row.time_min,
      },
      {
        id: "timeMax",
        label: t("timeSelectorEndDate"),
        type: "string",
        value: (row) => row.time_max,
      },
      {
        id: "depthMin",
        label: t("depthFilterStartDepth"),
        type: "number",
        value: (row) => row.depth_min,
      },
      {
        id: "depthMax",
        label: t("depthFilterEndDepth"),
        type: "number",
        value: (row) => row.depth_max,
      },
    ],
    [t, recordIdField.label],
  );

  const markerRecordPinned = highlightedRecord?.datasetPk === dataset.pk;
  const pinnedKeys = useMemo(
    () =>
      new Set([
        ...passes.keys(),
        ...(markerRecordPinned ? [highlightedRecord.profileId] : []),
      ]),
    [passes, markerRecordPinned, highlightedRecord],
  );

  // A trajectory's records are its tracks (shapeQuery aliases trajectory_id
  // into profile_id), so "Show on map" draws the whole track; others are
  // ringed where sampled.
  const onMapId = isTrajectoryDataset
    ? selectedTrajectory?.datasetPk === dataset.pk
      ? selectedTrajectory.trajectoryId
      : undefined
    : mappedRecord?.datasetPk === dataset.pk
      ? mappedRecord.recordId
      : undefined;
  const toggleOnMap = (recordId) => {
    const shown = onMapId === recordId;
    if (isTrajectoryDataset) {
      setSelectedTrajectory(
        shown
          ? undefined
          : {
              datasetPk: dataset.pk,
              datasetTitle: dataset.title,
              trajectoryId: recordId,
              frameView: true,
            },
      );
    } else {
      setMappedRecord(
        shown
          ? undefined
          : { datasetPk: dataset.pk, recordId, frameView: true },
      );
    }
  };

  const {
    shown: shownEovs,
    hidden: hiddenEovCount,
    expanded: eovsExpanded,
    toggle: toggleEovsExpanded,
  } = useExpandableList(dataset.eovs, EOV_VISIBLE_LIMIT);

  // The Filters panel's catalog is the only source of EOV definitions.
  const eovDefinitions = useMemo(
    () =>
      new Map(
        eovsSelected.map((option) => [
          option.title,
          { en: option.hover_en, fr: option.hover_fr },
        ]),
      ),
    [eovsSelected],
  );

  const inSelection = selectedPks.has(dataset.pk);

  // Both tabs stay mounted so a feature search and its page survive a trip to
  // the other; anything pointing at a feature belongs to Data and opens it.
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const tab = searchParams.get(TAB_PARAM) === "data" ? "data" : "metadata";
  // Replace, not push: flipping between views of one page is not a place to go
  // Back to.
  const setTab = useCallback(
    (key) =>
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (key === "data") next.set(TAB_PARAM, "data");
          else next.delete(TAB_PARAM);
          return next;
        },
        { replace: true, state: location.state },
      ),
    [setSearchParams, location.state],
  );
  const bodyRef = useRef(null);
  const jumpToData =
    markerRecordPinned || passes.size > 0 || onMapId !== undefined;
  useEffect(() => {
    if (jumpToData && tab !== "data") setTab("data");
    // Only a newly pointed-at feature moves the tab, not the user's own switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToData]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [tab]);

  return (
    <div
      className="datasetInspector"
      ref={inspectorRef}
      onMouseEnter={() => setHoveredDataset(dataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      <div className="datasetTitleBlock" onDoubleClick={zoomToDataset}>
        <h2 className="datasetTitle">
          <FileEarmarkText
            className="datasetTitleIcon"
            size={20}
            aria-hidden="true"
          />
          {dataset.title}
        </h2>
        <NoTranslationNote
          values={[dataset.title_translated, metadata?.abstract]}
        />
        <Organizations {...metadata} />
        <div className="datasetTitleActions">
          <button
            type="button"
            className={classNames("datasetTitleAction", {
              active: inSelection,
            })}
            onClick={() => handleSelectDataset(dataset)}
            disabled={isGrid}
            aria-pressed={inSelection}
            title={t(
              isGrid
                ? "griddapNotDownloadableTooltip"
                : inSelection
                  ? "datasetInspectorRemoveTitle"
                  : "featureCardAddOne",
            )}
          >
            {inSelection ? (
              <CheckCircleFill size={15} aria-hidden="true" />
            ) : (
              <PlusCircle size={15} aria-hidden="true" />
            )}
            {t(
              inSelection
                ? "datasetInspectorAddedText"
                : "datasetInspectorAddText",
            )}
          </button>
          <ZoomToDataset />
          <Citation {...metadata} />
        </div>
        {/* A filter can exclude a dataset whose page is already open; the page
            stays, but its records now follow filters it no longer meets. */}
        {inspectDatasetExcluded && (
          <div className="datasetNotInResults" role="status">
            <InfoCircle size={14} aria-hidden="true" />
            <span>{t("datasetNotInResultsText")}</span>
            <button
              type="button"
              className="datasetNotInResultsBack"
              onClick={returnToList}
            >
              {t("datasetNotInResultsBackText")}
            </button>
          </div>
        )}
      </div>
      <div className="datasetTabs" role="tablist">
        {[
          ["metadata", "datasetInspectorMetadataTab", InfoCircle],
          ["data", "datasetInspectorDataTab", Table],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`datasetTab-${key}`}
            aria-selected={tab === key}
            aria-controls={`datasetPanel-${key}`}
            className="datasetTab"
            data-tip-highlight={
              key === "data" ? tipHighlight("showData") : undefined
            }
            onClick={() => setTab(key)}
          >
            <Icon size={14} aria-hidden="true" />
            {t(label)}
          </button>
        ))}
      </div>
      <div className="datasetInspectorBody" ref={bodyRef}>
        <div
          role="tabpanel"
          id="datasetPanel-metadata"
          aria-labelledby="datasetTab-metadata"
          hidden={tab !== "metadata"}
        >
          <DatasetAbstract {...metadata} />
          <dl className="datasetMetaSheet">
            <div className="metaCell">
              <dt className="metadataLabel">
                {t("datasetInspectorGeometryText")}
              </dt>
              <dd className="metadataValue">
                <span className="metadataFact">{geometryLabel}</span>
              </dd>
            </div>
            <div className="metaCell">
              <dt className="metadataLabel">
                {t("datasetInspectorPlatformText")}
              </dt>
              <dd className="metadataValue">
                {dataset.platform ? (
                  <span className="metadataFact">
                    <span className="metadataPlatformGlyph" aria-hidden="true">
                      <DatasetPlatformIcon
                        platform={dataset.platform}
                        cdmDataType={dataset.cdm_data_type}
                        sourceType={dataset.source_type}
                        t={t}
                        decorative
                      />
                    </span>
                    {t(dataset.platform)}
                  </span>
                ) : (
                  <span className="metadataEmpty">—</span>
                )}
              </dd>
            </div>
            <div className="metaCell">
              <dt className="metadataLabel">
                {isGrid
                  ? t("griddapNodesText")
                  : t("datasetInspectorRecordsText")}
              </dt>
              <dd className="metadataValue">
                {isGrid ? (
                  <GridNodeCount dimensions={dataset.grid_dimensions} />
                ) : (
                  <span className="metadataFact">
                    {dataset.profiles_count !== dataset.n_profiles
                      ? `${dataset.profiles_count} / ${dataset.n_profiles}`
                      : dataset.profiles_count}
                  </span>
                )}
              </dd>
            </div>
            {/* coverage_time_max spans every record, so it is not the end of any
                one record's range. */}
            {dataset.coverage_time_max && (
              <div className="metaCell">
                <dt className="metadataLabel">
                  {t("datasetInspectorLatestDataText")}
                </dt>
                <dd className="metadataValue metadataValueCentered">
                  <span className="metadataFact">
                    {formatInstant(dataset.coverage_time_max)}
                  </span>
                  {dataset.is_realtime && (
                    <span
                      className="datasetTitleLive"
                      title={t("datasetRealtimeBadgeTitle")}
                    >
                      {t("datasetRealtimeBadgeText")}
                    </span>
                  )}
                </dd>
              </div>
            )}
            <MetadataExtentCells {...metadata} />
            <div className="metaCell">
              <dt className="metadataLabel">
                {t("datasetInspectorOceanVariablesText")}
              </dt>
              <dd className="metadataValue">
                {!dataset.eovs?.length && (
                  <span className="metadataEmpty">—</span>
                )}
                {shownEovs.map((eov) => (
                  <Tooltip
                    key={eov}
                    placement="bottom"
                    delay={150}
                    content={eovDefinitions.get(eov)?.[i18n.language]}
                  >
                    <span className="metadataChip">{t(eov)}</span>
                  </Tooltip>
                ))}
                {(hiddenEovCount > 0 || eovsExpanded) && (
                  <button
                    type="button"
                    className="listCardTagsMore"
                    onClick={toggleEovsExpanded}
                    aria-expanded={eovsExpanded}
                    title={
                      eovsExpanded
                        ? t("listCardTagsFewerText")
                        : t("listCardTagsMoreTitle", {
                            total: dataset.eovs.length,
                          })
                    }
                  >
                    {eovsExpanded
                      ? t("listCardTagsFewerText")
                      : `+${hiddenEovCount}`}
                  </button>
                )}
              </dd>
            </div>
            <KeywordsCell {...metadata} />
            <LicenseCell {...metadata} />
            <SourceLinksCell dataset={dataset} />
          </dl>
          <DatasetMetadata dataset={dataset} {...metadata} />
        </div>
        <div
          role="tabpanel"
          id="datasetPanel-data"
          aria-labelledby="datasetTab-data"
          hidden={tab !== "data"}
        >
          {/* Mounted only while shown, so a page left on Metadata never loads
              the Plotly chunk. */}
          {tab === "data" && (
            <TimeDistribution datasetPk={dataset.pk} query={query} />
          )}
          {isGrid && (
            <GriddapDetails
              dataset={dataset}
              activeWmsOverlay={activeWmsOverlay}
              setActiveWmsOverlay={setActiveWmsOverlay}
            />
          )}
          {dataset.source_type === "obis" && (
            <TaxonomyChart datasetId={dataset.dataset_id} />
          )}
          {hasRecordList && (
            <div className="recordSection">
              <div
                className="recordSectionHeader"
                data-tip-highlight={tipHighlight("showData")}
              >
                <strong>{t("datasetInspectorRecordTable")}</strong>
                <span className="recordHint">
                  {t(
                    isTrajectoryDataset
                      ? "trajectoryClickPreviewText"
                      : "datasetInspectorClickPreviewText",
                  )}
                </span>
                <IdCaption {...recordIdField} />
              </div>
              {markerRecordPinned && (
                <div className="recordMapClickHint">
                  <span className="recordMapClickSwatch" aria-hidden="true" />
                  {t("datasetInspectorMapClickHint")}
                  <button
                    type="button"
                    className="recordShowAll"
                    onClick={() => setHighlightedRecord(undefined)}
                  >
                    {t("datasetInspectorClearMapRecordText")}
                  </button>
                </div>
              )}
              {passes.size > 0 && (
                <div className="recordMapClickHint">
                  <span className="recordMapClickSwatch" aria-hidden="true" />
                  {t("datasetInspectorPassesHint", { count: passes.size })}
                </div>
              )}
              {loading ? (
                <SkeletonGroup className="cardList">
                  {Array.from({ length: 5 }, (_, i) => (
                    <ListCardSkeleton key={i} />
                  ))}
                </SkeletonGroup>
              ) : recordsError ? (
                <div className="cardListEmpty" role="alert">
                  {t("datasetInspectorRecordsLoadFailedText")}{" "}
                  <button
                    type="button"
                    className="recordShowAll"
                    onClick={() => setRecordsAttempt((attempt) => attempt + 1)}
                  >
                    {t("apiErrorRetryButton")}
                  </button>
                </div>
              ) : (
                <CardList
                  items={datasetRecords?.profiles}
                  keyOf={recordKeyOf}
                  sortFields={recordSortFields}
                  defaultSort={{ field: "id", dir: "desc" }}
                  filterPlaceholder={t("datasetInspectorFilterText")}
                  emptyText={t("datasetInspectorNoRecordsText")}
                  pinnedKeys={pinnedKeys}
                  focusKey={onMapId}
                  pagerLabel={t("datasetInspectorRecordsPagerLabel")}
                  perPageLabel={t("datasetInspectorRecordsPerPageLabel")}
                  renderItem={(row) => {
                    const eovs = (row.eovs ?? dataset.eovs)?.map((eov) =>
                      t(eov),
                    );
                    const onMap = onMapId === row.profile_id;
                    return (
                      <ListCard
                        id={row.profile_id || "—"}
                        pinned={pinnedKeys.has(row.profile_id)}
                        selected={onMap}
                        actions={
                          <>
                            {row.profile_id && (
                              <button
                                type="button"
                                className="listCardButton"
                                title={t("datasetInspectorShowDataTitle")}
                                onClick={() =>
                                  setInspectRecordID(row.profile_id)
                                }
                              >
                                <GraphUp size={13} aria-hidden="true" />
                                {t("datasetInspectorShowDataText")}
                              </button>
                            )}
                            {(isTrajectoryDataset || row.profile_id) && (
                              <button
                                type="button"
                                className="listCardButton"
                                aria-pressed={onMap}
                                title={t(
                                  onMap
                                    ? "datasetInspectorHideFromMapTitle"
                                    : isTrajectoryDataset
                                      ? "trajectoryTrackShowTitle"
                                      : "datasetInspectorShowOnMapTitle",
                                )}
                                onClick={() => toggleOnMap(row.profile_id)}
                              >
                                {onMap ? (
                                  <PinMapFill size={13} aria-hidden="true" />
                                ) : (
                                  <PinMap size={13} aria-hidden="true" />
                                )}
                                {t("datasetInspectorShowOnMapText")}
                              </button>
                            )}
                          </>
                        }
                      >
                        <CardField
                          label={t("datasetInspectorTimeframeText")}
                          nowrap
                        >
                          {formatInstantRange(row.time_min, row.time_max)}
                        </CardField>
                        <CardField label={t("datasetInspectorPassesText")}>
                          {passes.get(row.profile_id) && (
                            <PassButtons
                              recordId={row.profile_id}
                              passes={passes.get(row.profile_id)}
                              onPlot={(period) =>
                                setInspectRecordID(row.profile_id, { period })
                              }
                            />
                          )}
                        </CardField>
                        <CardField label={t("datasetInspectorDepthRangeText")}>
                          {formatRange(row.depth_min, row.depth_max, "m")}
                        </CardField>
                        {eovs?.length > 0 && (
                          <CardField
                            label={t("datasetInspectorOceanVariablesText")}
                          >
                            <CardTags values={eovs} />
                          </CardField>
                        )}
                      </ListCard>
                    );
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
