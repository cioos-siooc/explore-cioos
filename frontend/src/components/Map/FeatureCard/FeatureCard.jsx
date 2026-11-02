import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { GeoAlt } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import groupBy from "lodash-es/groupBy";

import CloseButton from "../../ui/CloseButton.jsx";
import { useChanged } from "../../../utilities.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import useCellDatasetDays from "./useCellDatasetDays.js";
import { pinnedPksOf, sortDatasets } from "../../../state/datasetSort.js";
import DatasetCard from "../../Controls/DatasetsTable/DatasetCard.jsx";
import "../../Controls/DatasetsTable/styles.css";
import "./styles.css";

// Every hover tooltip's content appears here too, so a device with no hover
// loses nothing. Never shown beside the open datasets sidebar, which already
// sorts and outlines what a click found (DatasetsTable's pinnedPks).

const VISIBLE_ROWS = 5;

export default function FeatureCard() {
  const { t, i18n } = useTranslation();
  const { featureQuery, setFeatureQuery, dataLayers, griddapCoverageVisible } =
    useMapState();
  const {
    filteredDatasets,
    listSort,
    inspectDataset,
    setInspectDataset,
    selectTrajectoryFromMap,
    handleSelectDataset,
    selectedPks,
    combinedQueries,
  } = useSelection();
  const { sidebarOpen, compactList } = useUI();
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
    (query?.datasetPks || []).some(
      (pk) =>
        filteredDatasets.find((row) => Number(row.pk) === Number(pk))
          ?.source_type === "obis",
    );
  useEffect(() => {
    if (open) offerTip([...(hasObis ? ["speciesName"] : []), "whatsHere"]);
  }, [open, hasObis, offerTip]);
  // Nothing has been clicked yet in this session: there is no card to park.
  if (!query) return null;

  // Exactly the datasets list's pinned rows, in its order: the card stands in
  // for that list while it is closed.
  const pinnedPks = pinnedPksOf(query);
  const rows = sortDatasets(
    filteredDatasets.filter((row) => pinnedPks.has(Number(row.pk))),
    listSort,
    { gridFirst: griddapCoverageVisible, t, language: i18n.language },
  );
  const itemsByPk = groupBy(query.items || [], "pk");
  const tracksOf = (row) =>
    (itemsByPk[row.pk] || []).filter((item) => item.kind === "track");

  const empty = rows.length === 0;
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const hidden = rows.length - shown.length;
  const tipTarget = shown.find((row) => row.cdm_data_type !== "Grid");

  // A single track under the click opens on that track; otherwise the
  // dataset's page.
  const openDataset = (row) => {
    const tracks = tracksOf(row);
    if (tracks.length === 1) {
      selectTrajectoryFromMap(row.pk, tracks[0].trajectoryId, row.title);
    } else {
      setInspectDataset(row);
    }
    close();
  };

  const countLabel = (value) =>
    t("mapHexCountDays", {
      total: Number(value || 0).toLocaleString(i18n.language),
    });

  // What the click found of this dataset, beside its catalogue-wide meta.
  const hereLine = (row) => {
    const items = itemsByPk[row.pk] || [];
    const count = datasetDays.get(Number(row.pk));
    return [
      ...tracksOf(row).map((item) => item.trajectoryId),
      // No figure yet (or the request failed): show none rather than a number
      // that isn't this dataset's.
      count === undefined ? null : countLabel(count),
      items.some((item) => item.aggregate) ? t("featureCardNearby") : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

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
          <div
            className={classNames("datasetsCardList featureCardList", {
              compact: compactList,
            })}
          >
            {shown.map((row) => {
              const here = hereLine(row);
              return (
                <DatasetCard
                  key={row.pk}
                  row={row}
                  selected={selectedPks.has(row.pk)}
                  onSelect={handleSelectDataset}
                  onInspect={openDataset}
                  tipHighlight={tipHighlight(
                    open && row === tipTarget && "whatsHere",
                  )}
                  t={t}
                  i18n={i18n}
                >
                  {here && <span className="featureCardHere">{here}</span>}
                </DatasetCard>
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
