import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useLocation, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import {
  BoxArrowUpRight,
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
  CitationCard,
  DatasetAbstract,
  KeywordsCell,
  LicenseCell,
  NoTranslationNote,
  Organizations,
  catalogueExtent,
  datasetSource,
  hostOf,
} from "../DatasetMetadata/DatasetMetadata.jsx";
import useDatasetMetadata from "../DatasetMetadata/useDatasetMetadata.js";
import TaxonomyChart from "../TaxonomyChart/TaxonomyChart.jsx";
import TimeDistribution from "../TimeDistribution/TimeDistribution.jsx";
import { server } from "../../../config";
import { localizedCkanUrl } from "../../../downloadLinks.js";
import reportError from "../../../state/reportError.js";
import { useActivityTask } from "../../../state/activity/ActivityProvider.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { TAB_PARAM } from "../../../state/selection/previewParams.js";
import useWideView from "../../../state/selection/useWideView.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import {
  dataLayerKeyForDataset,
  DATA_LAYER_LABEL_KEYS,
  TRAJECTORY_TYPE_KEYS,
} from "../../../state/dataLayers.js";
import { gridNodeFactors, totalGridNodes } from "../../../wmsUtilities";
import {
  formatDepthRange,
  formatInstant,
  formatInstantRange,
  formatRange,
} from "../../../utilities.jsx";
import CardList from "./CardList.jsx";
import {
  DatasetPlatformIcon,
  locationsText,
} from "../DatasetsTable/DatasetCard.jsx";
import { platformLabel } from "../../../platformVocab.js";
import ListCard, {
  CardField,
  CardTags,
  ListCardSkeleton,
  useExpandableList,
} from "./ListCard.jsx";
import useTrajectoryPasses from "./useTrajectoryPasses.js";
import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
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

const day = (value) => value?.slice(0, 10);

// The harvest stores an OBIS occurrence without a depth as 0 m, so an all-zero
// OBIS range means "not recorded", not "at the surface".
function measuredDepth(dataset, footprint) {
  if (!footprint) return undefined;
  const { depth_min: min, depth_max: max } = footprint;
  if (dataset.source_type === "obis" && !max) return undefined;
  return formatDepthRange(min, max);
}

// A fact the harvested features measured, else the catalogue record's claim,
// labelled as such: the two can disagree, and the page leads with the data.
function FootprintCell({ label, measured, declared, loading, children }) {
  const { t } = useTranslation();
  const value = measured ?? declared;
  if (!loading && !value) return null;
  return (
    <div className="metaCell">
      <dt className="metadataLabel">{label}</dt>
      <dd className="metadataValue metadataValueCentered">
        {loading && !value ? (
          <Skeleton text width="9rem" />
        ) : (
          <>
            <span className="metadataFact">{value}</span>
            {measured === undefined && (
              <span className="metadataProvenance">
                {t("datasetInspectorCatalogueValueText")}
              </span>
            )}
            {children}
          </>
        )}
      </dd>
    </div>
  );
}

// Every way to act on the dataset, as one row of matching buttons. Adding to
// the download and opening the source come first: equal exits (PRODUCT.md).
function DatasetActions({
  dataset,
  isGrid,
  inSelection,
  selectedCount,
  onAdd,
}) {
  const { t, i18n } = useTranslation();
  const source = datasetSource(dataset, t, i18n.language);
  // The source already is the catalogue when there's no server.
  const catalogueUrl =
    dataset.ckan_url &&
    (dataset.source_type === "obis" || dataset.erddap_url) &&
    localizedCkanUrl(dataset.ckan_url, i18n.language);
  return (
    <div className="datasetTitleActions">
      <button
        type="button"
        className={classNames("datasetAction", { active: inSelection })}
        onClick={onAdd}
        disabled={isGrid}
        aria-pressed={inSelection}
        title={
          isGrid
            ? t("griddapNotDownloadableTooltip")
            : inSelection
              ? t("datasetExitAddedHint", { count: selectedCount })
              : t("datasetExitAddHint")
        }
      >
        {inSelection ? (
          <CheckCircleFill size={14} aria-hidden="true" />
        ) : (
          <PlusCircle size={14} aria-hidden="true" />
        )}
        {t(inSelection ? "datasetExitAddedText" : "datasetExitAddText")}
      </button>
      {source && (
        <a
          className="datasetAction"
          href={source.url}
          target="_blank"
          rel="noreferrer"
          title={t("datasetExitSourceTitle", { host: hostOf(source.url) })}
        >
          <BoxArrowUpRight size={13} aria-hidden="true" />
          {t("datasetExitSourceText", { source: source.name })}
        </a>
      )}
      {catalogueUrl && (
        <a
          className="datasetAction"
          href={catalogueUrl}
          target="_blank"
          rel="noreferrer"
          title={t("datasetCatalogueLinkTitle")}
        >
          <BoxArrowUpRight size={13} aria-hidden="true" />
          {t("datasetCatalogueLinkText")}
        </a>
      )}
      <ZoomToDataset />
    </div>
  );
}

const TAB_KEYS = ["metadata", "data"];

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
  const declared = catalogueExtent(metadata.metadata);
  const [datasetRecords, setDatasetRecords] = useState();
  const [trajectoryPlatforms, setTrajectoryPlatforms] = useState();
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
  // Every type is fetched: the response also carries the measured footprint
  // the facts sheet leads with.
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
  const [loading, setLoading] = useState(true);
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
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [dataset, recordsAttempt]);

  // Trajectory datasets: /trajectories/platforms is the only source for how many
  // fixes a track holds. It used to back a second card list of its own, whose
  // ids were the record list's ids over again — so the page offered the same
  // trajectory twice, and the copy the user reached only drew the track, never
  // the plot. One list now, and this is what keeps its Track fixes field.
  useEffect(() => {
    if (!isTrajectoryDataset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrajectoryPlatforms();
      return;
    }
    fetch(`${server}/trajectories/platforms?datasetPKs=${dataset.pk}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((platforms) => setTrajectoryPlatforms(platforms))
      .catch((error) => {
        reportError("trajectory platforms fetch failed", error);
        setTrajectoryPlatforms([]);
      });
  }, [dataset, isTrajectoryDataset]);

  // While a fetch runs, the previous response may belong to another dataset.
  const footprint = loading || recordsError ? undefined : datasetRecords;
  // A dataset without a cf_role id is one unnamed series: its record has
  // nothing to preview or point out.
  const singleSeries =
    datasetRecords?.profiles?.length === 1 &&
    !datasetRecords.profiles[0].profile_id;

  const trackFixesById = useMemo(
    () =>
      new Map(
        (trajectoryPlatforms || []).map((row) => [
          row.trajectory_id,
          row.n_points,
        ]),
      ),
    [trajectoryPlatforms],
  );

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
      // Only a trajectory's records have one, and only once its platforms have
      // landed — the field is absent everywhere else, so offering the sort
      // would be offering an order over nothing.
      ...(isTrajectoryDataset
        ? [
            {
              id: "fixes",
              label: t("trajectoryPlatformFixesText"),
              type: "number",
              value: (row) => trackFixesById.get(row.profile_id),
            },
          ]
        : []),
    ],
    [t, recordIdField.label, isTrajectoryDataset, trackFixesById],
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
  const [wide, setWide] = useWideView();
  const toggleOnMap = (recordId) => {
    const shown = onMapId === recordId;
    // Widened, the page covers the map it is about to draw on.
    if (!shown) setWide(false);
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
  const tabListRef = useRef(null);
  // Arrow keys move between tabs (WAI-ARIA tabs pattern); Tab leaves the list.
  const onTabKeyDown = (event) => {
    const index = TAB_KEYS.indexOf(tab);
    const next = {
      ArrowRight: TAB_KEYS[(index + 1) % TAB_KEYS.length],
      ArrowLeft: TAB_KEYS[(index - 1 + TAB_KEYS.length) % TAB_KEYS.length],
      Home: TAB_KEYS[0],
      End: TAB_KEYS[TAB_KEYS.length - 1],
    }[event.key];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabListRef.current?.querySelector(`#datasetTab-${next}`)?.focus();
  };
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

  // A tab panel normally; widened, a labelled column with its own scroll.
  const viewProps = (key) => ({
    className: classNames(`datasetPanel-${key}`, { datasetView: wide }),
    ...(wide
      ? {
          role: "region",
          "aria-labelledby": `datasetViewHeading-${key}`,
        }
      : {
          role: "tabpanel",
          id: `datasetPanel-${key}`,
          "aria-labelledby": `datasetTab-${key}`,
          hidden: tab !== key,
        }),
  });
  const viewHeading = (key, label, Icon) =>
    wide && (
      <h3 className="datasetViewHeading" id={`datasetViewHeading-${key}`}>
        <Icon size={14} aria-hidden="true" />
        {t(label)}
      </h3>
    );

  return (
    <div
      className={classNames("datasetInspector", { wide })}
      ref={inspectorRef}
      onMouseEnter={() => setHoveredDataset(dataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      <div className="datasetTitleBlock" onDoubleClick={zoomToDataset}>
        <h2 className="datasetTitle" title={dataset.title}>
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
        <DatasetActions
          dataset={dataset}
          isGrid={isGrid}
          inSelection={inSelection}
          selectedCount={selectedPks.size}
          onAdd={() => handleSelectDataset(dataset)}
        />
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
      {/* Widened, both views sit side by side and need no tabs. */}
      {!wide && (
        <div
          className="datasetTabs"
          role="tablist"
          ref={tabListRef}
          onKeyDown={onTabKeyDown}
        >
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
              tabIndex={tab === key ? 0 : -1}
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
      )}
      <div className="datasetInspectorBody" ref={bodyRef}>
        <div {...viewProps("metadata")}>
          {viewHeading("metadata", "datasetInspectorMetadataTab", InfoCircle)}
          <CitationCard {...metadata} />
          <DatasetAbstract {...metadata} />
          <dl className="datasetMetaSheet">
            <div className="metaCell">
              <dt className="metadataLabel">
                {t("datasetsTableHeaderTypeText")}
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
                {dataset.platform && dataset.platform !== "unknown" ? (
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
                    {platformLabel(dataset.platform, i18n.language)}
                  </span>
                ) : (
                  <span className="metadataEmpty">—</span>
                )}
              </dd>
            </div>
            <div className="metaCell">
              <dt className="metadataLabel">
                {t(
                  isGrid
                    ? "griddapNodesText"
                    : isTrajectoryDataset
                      ? "datasetInspectorTracksText"
                      : "datasetsTableHeaderLocationsText",
                )}
              </dt>
              <dd className="metadataValue">
                {isGrid ? (
                  <GridNodeCount dimensions={dataset.grid_dimensions} />
                ) : (
                  <span className="metadataFact">
                    {locationsText(dataset, t)}
                  </span>
                )}
              </dd>
            </div>
            {dataset.days != null && (
              <div className="metaCell">
                <dt className="metadataLabel">
                  {t("datasetsCardSortDaysText")}
                </dt>
                <dd className="metadataValue">
                  <span className="metadataFact">
                    {t("datasetCardDays", { count: Number(dataset.days) })}
                  </span>
                </dd>
              </div>
            )}
            <FootprintCell
              label={t("metadataTemporalExtentText")}
              measured={
                footprint &&
                formatRange(day(footprint.time_min), day(footprint.time_max))
              }
              declared={declared.period}
              loading={loading}
            >
              {isRealtime && (
                <span
                  className="datasetTitleLive"
                  title={t("datasetRealtimeBadgeTitle")}
                >
                  {t("datasetRealtimeBadgeText")}
                </span>
              )}
            </FootprintCell>
            {/* Down to the minute only matters while the data still arrives. */}
            {isRealtime && dataset.coverage_time_max && (
              <div className="metaCell">
                <dt className="metadataLabel">
                  {t("datasetInspectorLatestDataText")}
                </dt>
                <dd className="metadataValue">
                  <span className="metadataFact">
                    {formatInstant(dataset.coverage_time_max)}
                  </span>
                </dd>
              </div>
            )}
            <FootprintCell
              label={t("metadataVerticalExtentText")}
              measured={measuredDepth(dataset, footprint)}
              declared={declared.depth}
              loading={loading}
            />
            <div className="metaCell">
              <dt className="metadataLabel">
                {t("datasetInspectorOceanVariablesText")}
              </dt>
              <dd className="metadataValue">
                {!dataset.eovs?.length && (
                  <span className="metadataEmpty">—</span>
                )}
                {shownEovs.map((eov) => {
                  const definition = eovDefinitions.get(eov)?.[i18n.language];
                  return (
                    <Tooltip
                      key={eov}
                      placement="bottom"
                      delay={150}
                      content={definition}
                    >
                      {/* Focusable so keyboard users reach the definition too. */}
                      <span
                        className="metadataChip"
                        tabIndex={definition ? 0 : undefined}
                        aria-description={definition}
                      >
                        {t(eov)}
                      </span>
                    </Tooltip>
                  );
                })}
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
          </dl>
          <DatasetMetadata dataset={dataset} {...metadata} />
        </div>
        <div {...viewProps("data")}>
          {viewHeading("data", "datasetInspectorDataTab", Table)}
          {/* Mounted only while shown, so a page left on Metadata never loads
              the Plotly chunk. */}
          {(wide || tab === "data") && (
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
                    singleSeries
                      ? "datasetInspectorSingleSeriesText"
                      : isTrajectoryDataset
                        ? "trajectoryClickPreviewText"
                        : "datasetInspectorClickPreviewText",
                  )}
                </span>
                {!singleSeries && <IdCaption {...recordIdField} />}
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
              ) : singleSeries ? null : (
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
                          {formatDepthRange(row.depth_min, row.depth_max)}
                        </CardField>
                        {isTrajectoryDataset && (
                          <CardField label={t("trajectoryPlatformFixesText")}>
                            {trackFixesById
                              .get(row.profile_id)
                              ?.toLocaleString()}
                          </CardField>
                        )}
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
