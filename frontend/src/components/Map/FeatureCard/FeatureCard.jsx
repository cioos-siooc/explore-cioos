import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { CheckCircleFill, GeoAlt, PlusCircle } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import CloseButton from "../../ui/CloseButton.jsx";
import { useChanged } from "../../../utilities.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import useCellDatasetDays from "./useCellDatasetDays.js";
import {
  DatasetCardMeta,
  DatasetPlatformIcon,
} from "../../Controls/DatasetsTable/DatasetCard.jsx";
import "../../Controls/DatasetsTable/styles.css";
import "./styles.css";

// Every hover tooltip's content appears here too, so a device with no hover
// loses nothing. Never shown beside the open datasets sidebar, which already
// sorts and outlines what a click found (DatasetsTable's pinnedPks).

const VISIBLE_ROWS = 5;

const KIND_ORDER = ["track", "observation", "grid"];

export default function FeatureCard() {
  const { t, i18n } = useTranslation();
  const { featureQuery, setFeatureQuery, dataLayers } = useMapState();
  const {
    pointsData,
    inspectDataset,
    setInspectDataset,
    selectTrajectoryFromMap,
    addDatasetsToSelection,
    selectedPks,
    combinedQueries,
  } = useSelection();
  const { sidebarOpen } = useUI();
  const { offerTip, tipHighlight } = useTips();

  const [expanded, setExpanded] = useState(false);

  // The card slides off screen, but dismissing clears `featureQuery` at once;
  // this holds the last answer so the card doesn't blank halfway out.
  const [held, setHeld] = useState(featureQuery);
  if (featureQuery && featureQuery !== held) setHeld(featureQuery);
  const query = featureQuery ?? held;

  // Empty until it lands, so a row shows no figure rather than the cell's.
  const datasetDays = useCellDatasetDays(query, combinedQueries, dataLayers);

  const close = useCallback(() => setFeatureQuery(null), [setFeatureQuery]);

  // A fresh query is a fresh card: collapse any "show all" the last one was
  // left in.
  if (useChanged(query?.nonce)) setExpanded(false);

  useEffect(() => {
    if (!featureQuery) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [featureQuery, close]);

  // The query is left alone so the card picks back up once neither the
  // sidebar nor a dataset view is in the way.
  const open = Boolean(featureQuery) && !sidebarOpen && !inspectDataset;
  // Species records under the click make it the moment to say they can be
  // searched for by name.
  const hasObis =
    open &&
    (query?.items || []).some(
      (item) =>
        pointsData.find((row) => Number(row.pk) === item.pk)?.source_type ===
        "obis",
    );
  useEffect(() => {
    if (open) offerTip([...(hasObis ? ["speciesName"] : []), "whatsHere"]);
  }, [open, hasObis, offerTip]);
  // Nothing has been clicked yet in this session: there is no card to park.
  if (!query) return null;

  // Observation rows resolve against the current results (the tiles carry no
  // titles), and one that doesn't is not in the list the buttons act on, so it
  // is dropped. Tracks and grids carry their own titles and only dataset-level
  // filters, so they can be drawn for a dataset pointQuery dropped; they stay,
  // with the result-row actions withheld.
  const byPk = new Map(pointsData.map((row) => [Number(row.pk), row]));

  // A marker click's featureQuery is deliberately item-less (Map.jsx's
  // handleMapClick): it only pins the dataset in the list.
  const rows = (query.items || [])
    .map((item) => {
      const row = byPk.get(item.pk);
      if (!row && item.kind === "observation") return null;
      return {
        ...item,
        title: row?.title || item.title,
        platform: row?.platform || item.platform,
        // undefined until the breakdown lands, and for a track or grid.
        count: datasetDays.get(item.pk),
        row,
        // A track without a result row still opens: selectTrajectoryFromMap
        // draws the platform's history and leaves the page alone.
        openable: item.kind === "track" || Boolean(row),
        // Griddap is metadata-only and never enters the selection.
        selectable: item.kind !== "grid" && row?.cdm_data_type !== "Grid",
        inSelection: selectedPks.has(row?.pk),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        (b.count || 0) - (a.count || 0),
    );

  const empty = rows.length === 0;
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const hidden = rows.length - shown.length;

  const openDataset = (entry) => {
    if (entry.kind === "track") {
      selectTrajectoryFromMap(entry.pk, entry.trajectoryId, entry.title);
      close();
      return;
    }
    if (entry.row) {
      setInspectDataset(entry.row);
      close();
    }
  };

  // Adding keeps the card open: picking several datasets under one click
  // is the normal case.
  const addOne = (pk) => addDatasetsToSelection([pk]);

  // A track or grid row without a result row still gets its kind's glyph.
  const kindIcon = (entry) => (
    <DatasetPlatformIcon
      platform={entry.platform}
      cdmDataType={
        entry.row?.cdm_data_type ??
        { track: "Trajectory", grid: "Grid" }[entry.kind]
      }
      sourceType={entry.row?.source_type}
      t={t}
    />
  );

  const countLabel = (value) =>
    t("mapHexCountDays", {
      total: Number(value || 0).toLocaleString(i18n.language),
    });

  return (
    <div
      data-testid="feature-card"
      data-map-cover={open || undefined}
      className={classNames("featureCard", {
        open,
        featureCardEmpty: empty,
      })}
      role="dialog"
      aria-label={t("featureCardTitle")}
    >
      <div className="featureCardHeader">
        <span className="featureCardHeadingIcon" aria-hidden="true">
          <GeoAlt size={20} />
        </span>
        <div className="featureCardHeading">
          <span className="featureCardHeadingTitleRow">
            <span className="featureCardHeadingTitle">
              {t("featureCardTitle")}
            </span>
            {!empty && (
              <span
                className="featureCardMapClickSwatch"
                aria-hidden="true"
                title={t("featureCardMapClickHint")}
              />
            )}
            {!empty && (
              <span className="featureCardHeadingCounter">
                {t("featureCardSummary", { count: rows.length })}
              </span>
            )}
          </span>
          {!empty && query.observationCount > 0 && (
            <span className="featureCardHeadingMeta">
              {countLabel(query.observationCount)}
            </span>
          )}
        </div>
        <CloseButton label={t("featureCardClose")} onClick={close} />
      </div>

      {empty ? (
        <p className="featureCardEmptyText">{t("featureCardEmpty")}</p>
      ) : (
        <>
          <div className="featureCardList">
            {shown.map((entry, index) => {
              const here =
                entry.kind === "track"
                  ? entry.trajectoryId || t("featureCardTrack")
                  : entry.kind === "grid"
                    ? t("featureCardGrid")
                    : [
                        // No figure yet (or the request failed): show none
                        // rather than a number that isn't this dataset's.
                        entry.count === undefined
                          ? null
                          : countLabel(entry.count),
                        entry.aggregate ? t("featureCardNearby") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
              // A grid the current results don't contain has no page to open:
              // the rectangles come from their own source and outlive the
              // filter.
              return (
                <div
                  className={classNames("featureCardRow", {
                    clickable: entry.openable,
                  })}
                  key={`${entry.kind}:${entry.pk}:${entry.trajectoryId ?? ""}`}
                  title={entry.title}
                  onClick={
                    entry.openable ? () => openDataset(entry) : undefined
                  }
                >
                  <span className="featureCardRowHeadline">
                    <button
                      type="button"
                      className={classNames("featureCardRowAdd", {
                        isSelected: entry.inSelection,
                      })}
                      onClick={(e) => {
                        e.stopPropagation();
                        addOne(entry.pk);
                      }}
                      // One is enough to point at; the sidebar list's own
                      // toggle stands in for it while the card is held back
                      // (see DatasetsTable).
                      data-tip-highlight={tipHighlight(
                        open && index === 0 && "whatsHere",
                      )}
                      disabled={!entry.selectable || entry.inSelection}
                      title={
                        !entry.selectable
                          ? t("griddapNotDownloadableTooltip")
                          : entry.inSelection
                            ? t("featureCardAlreadyAdded")
                            : t("featureCardAddOne")
                      }
                      aria-label={`${
                        entry.inSelection
                          ? t("featureCardAlreadyAdded")
                          : t("featureCardAddOne")
                      }: ${entry.title}`}
                    >
                      {entry.inSelection ? (
                        <CheckCircleFill size={16} aria-hidden="true" />
                      ) : (
                        <PlusCircle size={16} aria-hidden="true" />
                      )}
                    </button>
                    <span className="featureCardRowIcon">
                      {kindIcon(entry)}
                    </span>
                    {/* The row holds the add button, so it can't be a button
                        itself. */}
                    {entry.openable ? (
                      <button type="button" className="featureCardRowTitle">
                        {entry.title}
                      </button>
                    ) : (
                      <span className="featureCardRowTitle">{entry.title}</span>
                    )}
                  </span>
                  {entry.row && (
                    <DatasetCardMeta row={entry.row} t={t} i18n={i18n} />
                  )}
                  {here && <span className="featureCardRowMeta">{here}</span>}
                </div>
              );
            })}
          </div>

          {hidden > 0 && (
            <button
              type="button"
              className="featureCardMore"
              onClick={() => setExpanded(true)}
            >
              {t("featureCardShowMore", { n: hidden })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
