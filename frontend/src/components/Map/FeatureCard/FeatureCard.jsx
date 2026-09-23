import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircleFill,
  CircleFill,
  Download,
  GeoAlt,
  Grid3x3Gap,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import CloseButton from "../../ui/CloseButton.jsx";
import platformColors from "../../platformColors";
import { useChanged } from "../../../utilities.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import useCellDatasetDays from "./useCellDatasetDays.js";
import { DatasetCardMeta } from "../../Controls/DatasetsTable/DatasetCard.jsx";
import "../../Controls/DatasetsTable/styles.css";
import "./styles.css";

// The "what's here" card: the single answer to a click anywhere on the map.
//
// One gesture used to mean six different things depending on which layer owned
// the pixel — fly to zoom 7, build a hidden 20px bbox filter, overwrite the
// datasets filter, open a dataset page, or clear everything — arbitrated by a
// ladder of stand-aside tests the user could not see. Map.jsx now gathers
// everything under the click and hands it here; this card names what it found
// and puts each consequence behind its own button. Nothing happens on open.
//
// It is also what makes the map usable by touch. Every hover tooltip's content
// appears here too, so a device with no hover loses nothing, and on a phone the
// card is a half-height sheet rather than a popup — the map stays visible above
// it, which is the only way to see what a selection did.
//
// It never competes with the datasets sidebar for the same corner: the sidebar
// already sorts and outlines the datasets a click found (see DatasetsTable's
// pinnedPks), so once it is open the card would be a second, redundant answer
// to the same click sitting on top of the first.

// How far a stack has to grow before the list scrolls rather than the card.
const VISIBLE_ROWS = 5;

const KIND_ORDER = ["track", "observation", "grid"];

export default function FeatureCard() {
  const { t, i18n } = useTranslation();
  const { featureQuery, setFeatureQuery, dataLayers } = useMapState();
  const {
    pointsData,
    setInspectDataset,
    selectTrajectoryFromMap,
    addDatasetsToSelection,
    selectedPks,
    combinedQueries,
  } = useSelection();
  const { sidebarOpen } = useUI();

  const [expanded, setExpanded] = useState(false);

  // The card travels on and off screen rather than appearing and vanishing
  // (see styles.css), so it outlives the query that filled it: dismissing it
  // clears `featureQuery` at once — that is also what un-rings the region on
  // the map — and a card that blanked halfway out would be a worse exit than
  // none. This holds the last answer so it is still the one on screen while it
  // leaves. Adjusted during render rather than in an effect, the same shape
  // useChanged is built on.
  const [held, setHeld] = useState(featureQuery);
  if (featureQuery && featureQuery !== held) setHeld(featureQuery);
  const query = featureQuery ?? held;

  // What each dataset under the click contributes to the cell's figure. The
  // tile only carries the cell TOTAL, which is why this is asked for
  // separately — see the hook. Empty until it lands, so a row shows no figure
  // rather than the cell's, which is what every row used to show.
  const datasetDays = useCellDatasetDays(query, combinedQueries, dataLayers);

  const close = useCallback(() => setFeatureQuery(null), [setFeatureQuery]);

  // A fresh query is a fresh card: collapse any "show all" the last one was
  // left in.
  if (useChanged(query?.nonce)) setExpanded(false);

  // Escape closes, like every other dismissable surface in the app.
  useEffect(() => {
    if (!featureQuery) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [featureQuery, close]);

  // The datasets sidebar already answers "what did that click find?" once it's
  // open — see the comment up top. The query itself is left alone so the card
  // picks back up where it left off if the sidebar closes again.
  const open = Boolean(featureQuery) && !sidebarOpen;
  // Nothing has been clicked yet in this session: there is no card to park.
  if (!query) return null;

  // The hex and point tiles carry dataset pks but no titles, so an observation
  // row has to resolve against the current results to have anything to say —
  // and one that doesn't resolve is genuinely not in the list the buttons act
  // on, so it is dropped.
  //
  // Tracks and grids are the other way round: they come from their own sources,
  // which apply only the dataset-level filters, so they can still be drawn for a
  // dataset that pointQuery's depth/bbox/polygon predicates dropped — and they
  // carry their own titles. Dropping those rows would leave something plainly
  // visible on the map that the card claimed was not there. They stay, and only
  // the actions that genuinely need a result row are withheld.
  const byPk = new Map(pointsData.map((row) => [Number(row.pk), row]));

  // A marker click's featureQuery is deliberately item-less (see Map.jsx's
  // handleMapClick): it opens the dataset page directly and only sets this to
  // pin the dataset in the list, so the card itself has nothing to list.
  const rows = (query.items || [])
    .map((item) => {
      const row = byPk.get(item.pk);
      if (!row && item.kind === "observation") return null;
      return {
        ...item,
        title: row?.title || item.title,
        platform: row?.platform || item.platform,
        // undefined until the breakdown lands, and for a track or grid, which
        // have no cell figure of their own.
        count: datasetDays.get(item.pk),
        row,
        // A dataset page resolves out of pointsData. A track without one still
        // opens: selectTrajectoryFromMap draws the platform's history either
        // way and leaves the page alone when it can't resolve the dataset,
        // which is exactly what clicking the track used to do.
        openable: item.kind === "track" || Boolean(row),
        // Griddap is metadata-only: it never enters the selection, and the
        // list's own button is disabled for one, so the card says the same
        // rather than offering a button that would quietly do nothing.
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

  // Everything under the click resolved away (all of it filtered out of the
  // current results): say so rather than showing an empty card.
  const empty = rows.length === 0;
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const hidden = rows.length - shown.length;

  const openDataset = (entry) => {
    if (entry.kind === "track") {
      // Same call the inspector's platform table makes: open the page and draw
      // the platform's track in one batched write.
      selectTrajectoryFromMap(entry.pk, entry.trajectoryId, entry.title);
      close();
      return;
    }
    if (entry.row) {
      setInspectDataset(entry.row);
      close();
    }
  };

  // Adding a row keeps the card open: picking two of the five datasets under
  // one click is the normal case, and closing after the first would make the
  // user click the same hex again for the second.
  //
  // "Selection", not "download": these datasets are being set aside. Downloading
  // is one thing you can then do with them, from the list's footer.
  const addOne = (pk) => addDatasetsToSelection([pk]);

  const kindIcon = (entry) => {
    if (entry.kind === "grid") {
      return <Grid3x3Gap size={13} aria-hidden="true" />;
    }
    if (entry.kind === "track") {
      return <ArrowRight size={13} aria-hidden="true" />;
    }
    const platformColor = platformColors.find(
      (pc) => pc.platform === entry.platform,
    );
    return (
      <CircleFill
        size={9}
        aria-hidden="true"
        style={platformColor ? { color: platformColor.color } : undefined}
      />
    );
  };

  const countLabel = (value) =>
    t("mapHexCountDays", {
      total: Number(value || 0).toLocaleString(i18n.language),
    });

  // Pinned to the bottom-left corner of the map on desktop and to the bottom
  // edge on phones — see styles.css, where the media query overrides `left`,
  // `inset` and friends wholesale, the direction it travels in included.
  return (
    <div
      data-testid="feature-card"
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
                {t("featureCardSummary", { n: rows.length })}
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
            {shown.map((entry) => (
              <div
                className="featureCardRow"
                key={`${entry.kind}:${entry.pk}:${entry.trajectoryId ?? ""}`}
              >
                {/* A gridded footprint the current results don't contain has no
                    page to open — the rectangles come from their own source and
                    outlive the filter that dropped the dataset. It still reads
                    as a row (it is genuinely here) and its download button
                    still brings it in; it just isn't a button pretending to
                    lead somewhere. */}
                <button
                  type="button"
                  className="featureCardRowOpen"
                  onClick={() => openDataset(entry)}
                  disabled={!entry.openable}
                  title={entry.title}
                >
                  <span className="featureCardRowIcon">{kindIcon(entry)}</span>
                  <span className="featureCardRowText">
                    <span className="featureCardRowTitle">{entry.title}</span>
                    {entry.row && (
                      <DatasetCardMeta row={entry.row} t={t} i18n={i18n} />
                    )}
                    <span className="featureCardRowMeta">
                      {entry.kind === "track"
                        ? entry.trajectoryId || t("featureCardTrack")
                        : entry.kind === "grid"
                          ? t("featureCardGrid")
                          : [
                              // No figure yet (or the request failed): the row
                              // says what it can rather than showing a number
                              // that isn't this dataset's.
                              entry.count === undefined
                                ? null
                                : countLabel(entry.count),
                              // An aggregate cell is a neighbourhood, not a
                              // place: say so rather than implying the precision
                              // an individual marker has.
                              entry.aggregate ? t("featureCardNearby") : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                    </span>
                  </span>
                </button>
                {/* Ticks the dataset into the download selection — the same
                    thing its checkbox in the list does, with the same glyphs:
                    a download sign while out, a tick once in. */}
                <button
                  type="button"
                  className={classNames("featureCardRowAdd", {
                    isSelected: entry.inSelection,
                  })}
                  onClick={() => addOne(entry.pk)}
                  disabled={!entry.selectable || entry.inSelection}
                  title={
                    !entry.selectable
                      ? t("griddapNotDownloadableTooltip")
                      : entry.inSelection
                        ? t("featureCardAlreadyAdded")
                        : t("featureCardAddOne")
                  }
                >
                  {entry.inSelection ? (
                    <CheckCircleFill size={15} aria-hidden="true" />
                  ) : (
                    <Download size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            ))}
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
