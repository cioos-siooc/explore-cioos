import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowCounterclockwise,
  BoundingBox,
  BroadcastPin,
  Eye,
  Pentagon,
  Trash,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { polygonIsRectangle } from "../../../utilities.jsx";
import { isMarkerTier } from "../../config.js";
import useDatasetCounts from "../../../state/useDatasetCounts.js";
import useResetAllFilters from "../../../state/useResetAllFilters.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import "./styles.css";

// The quick filters: the one-click ones that act on the map or are a single
// toggle rather than a list of options, as round buttons floating under the
// brand card. Search has no button here: the Filters button, Ctrl/⌘+K and
// typing on the map all open the search palette (see FilterSearch).
//
// Box and polygon share one Area button whose small menu picks the shape (or
// clears the one drawn), so the row carries one draw control rather than two.
//
// No armed-tool state: drawRequest is a *last* request rather than a current
// one (see MapStateProvider), so like every other UI here the Area button
// reads its lit state and icon off the shape on the map instead. Between
// arming a draw and closing the shape, it is not lit.
//
// Each button carries a caption naming it: a touch screen has no hover to show
// the title, and an icon alone was a guess. The reset is the one for both this
// row and the active-filter chips beneath it.
export default function QuickFilters() {
  const { t, i18n } = useTranslation();
  const { requestDraw, zoom } = useMapState();
  const { polygon, onlyInView, setOnlyInView, inViewCount, realtimeCount } =
    useSelection();
  const { ready: countsReady } = useDatasetCounts();
  const { realtimeOnly, setRealtimeOnly } = useFilters();
  const { offerTip, tipHighlight } = useTips();
  const [canReset, resetAll] = useResetAllFilters();
  // Zoomed in to a local area, the whole-catalogue list stops matching the map.
  const zoomedIn = isMarkerTier(zoom) && !onlyInView;
  useEffect(() => {
    if (zoomedIn) offerTip("inView");
  }, [zoomedIn, offerTip]);

  const areaMenuId = useId();
  const inViewCountId = useId();
  const realtimeCountId = useId();
  const areaRef = useRef(null);
  const areaButtonRef = useRef(null);
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);

  // Pointer, not only blur: Safari never focuses a clicked button, so a click
  // elsewhere would leave the menu up.
  useEffect(() => {
    if (!areaMenuOpen) return;
    function onPointerDown(e) {
      if (!areaRef.current?.contains(e.target)) setAreaMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [areaMenuOpen]);

  const hasShape = Boolean(polygon);
  const boxActive = hasShape && polygonIsRectangle(polygon);
  const polygonActive = hasShape && !boxActive;

  // A toggle that is off previews how many of the listed datasets it would
  // keep, under its icon. Once on, the tally above already says it. Not before
  // the counts land, so it never flashes a zero. Compact ("2.2K") to fit the
  // circle; assistive tech gets the exact number.
  function countPreview(applied, count, id, testId) {
    if (applied || !countsReady) return null;
    return (
      <>
        <span className="quickFilterCount" data-testid={testId}>
          {count.toLocaleString(i18n.language, {
            notation: "compact",
            maximumFractionDigits: 1,
          })}
        </span>
        <span id={id} className="sr-only">
          {t("quickFilterCountDescription", { count })}
        </span>
      </>
    );
  }

  function chooseArea(mode) {
    requestDraw(mode);
    setAreaMenuOpen(false);
    areaButtonRef.current?.focus();
  }

  return (
    <div
      className="quickFilters"
      role="group"
      aria-label={t("topBarQuickFiltersLabel")}
      data-testid="quick-filters"
    >
      <div
        ref={areaRef}
        className={classNames("quickFilterArea", { open: areaMenuOpen })}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget))
            setAreaMenuOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !areaMenuOpen) return;
          setAreaMenuOpen(false);
          areaButtonRef.current?.focus();
        }}
      >
        <button
          ref={areaButtonRef}
          type="button"
          className={classNames("quickFilterButton", { applied: hasShape })}
          data-testid="quick-filter-area"
          onClick={() => setAreaMenuOpen(!areaMenuOpen)}
          aria-expanded={areaMenuOpen}
          aria-controls={areaMenuOpen ? areaMenuId : undefined}
          title={t("quickFilterAreaTitle")}
          aria-label={t("spatialFilterFilterName")}
        >
          {polygonActive ? (
            <Pentagon size={18} aria-hidden="true" />
          ) : (
            <BoundingBox size={18} aria-hidden="true" />
          )}
          <span className="quickFilterCaption" aria-hidden="true">
            {t("spatialFilterFilterName")}
          </span>
        </button>
        {areaMenuOpen && (
          <div
            id={areaMenuId}
            className="quickFilterAreaMenu"
            data-testid="quick-filter-area-menu"
          >
            <button
              type="button"
              className={classNames("quickFilterAreaItem", {
                selected: boxActive,
              })}
              data-testid="quick-filter-area-box"
              onClick={() => chooseArea("box")}
              aria-pressed={boxActive}
            >
              <BoundingBox size={16} aria-hidden="true" />
              {t("drawBoundingBoxOption")}
            </button>
            <button
              type="button"
              className={classNames("quickFilterAreaItem", {
                selected: polygonActive,
              })}
              data-testid="quick-filter-area-polygon"
              onClick={() => chooseArea("polygon")}
              aria-pressed={polygonActive}
            >
              <Pentagon size={16} aria-hidden="true" />
              {t("drawPolygonOption")}
            </button>
            {hasShape && (
              <button
                type="button"
                className="quickFilterAreaItem"
                data-testid="quick-filter-area-clear"
                onClick={() => chooseArea("clear")}
              >
                <Trash size={16} aria-hidden="true" />
                {t("quickFilterAreaClear")}
              </button>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: onlyInView })}
        data-testid="quick-filter-in-view"
        data-tip-highlight={tipHighlight("inView")}
        onClick={() => setOnlyInView(!onlyInView)}
        aria-pressed={onlyInView}
        title={t("quickFilterInViewTitle")}
        aria-label={t("datasetsCardOnlyInViewText")}
        aria-describedby={
          countsReady && !onlyInView ? inViewCountId : undefined
        }
      >
        <Eye size={18} aria-hidden="true" />
        {countPreview(
          onlyInView,
          inViewCount,
          inViewCountId,
          "quick-filter-in-view-count",
        )}
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionInView")}
        </span>
      </button>
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: realtimeOnly })}
        data-testid="quick-filter-realtime"
        data-tip-highlight={tipHighlight("realtime")}
        onClick={() => setRealtimeOnly(!realtimeOnly)}
        aria-pressed={realtimeOnly}
        title={t("quickFilterRealtimeTitle")}
        aria-label={t("realtimeFilterOptionText")}
        aria-describedby={
          countsReady && !realtimeOnly ? realtimeCountId : undefined
        }
      >
        <BroadcastPin size={18} aria-hidden="true" />
        {countPreview(
          realtimeOnly,
          realtimeCount,
          realtimeCountId,
          "quick-filter-realtime-count",
        )}
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionRealtime")}
        </span>
      </button>
      <button
        type="button"
        className="quickFilterButton quickFilterReset"
        data-testid="quick-filter-reset"
        // Disabled rather than removed while nothing is set, so the row keeps
        // its shape.
        disabled={!canReset}
        onClick={resetAll}
        title={t("resetFiltersButtonTooltipText")}
        aria-label={t("resetFiltersButtonTooltipText")}
      >
        <ArrowCounterclockwise size={18} aria-hidden="true" />
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionReset")}
        </span>
      </button>
    </div>
  );
}
