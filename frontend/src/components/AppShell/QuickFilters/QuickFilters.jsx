import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
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
import { ClearAllFiltersButton } from "../TopControls/ActiveFilterChips.jsx";
import useActiveFilters, {
  QUICK_FILTER_KEYS,
} from "../../../state/useActiveFilters.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import "./styles.css";

// The quick filters: the one-click ones that act on the map or are a single
// toggle rather than a list of options, as one line of type in the brand card
// (see TopControls) — "23 in view · 41 real-time · Area". Each counted one
// names how many of the filtered datasets it would leave.
// Search has no button here: the Filters button, Ctrl/⌘+K and typing on the
// map all open the search palette (see FilterSearch). Like every other filter,
// what they have set is also named by a chip below (see ActiveFilterChips).
//
// Box and polygon share one Area button whose small menu picks the shape (or
// clears the one drawn), so the row carries one draw control rather than two.
// It has no count: until a shape is drawn there is nothing to count.
//
// No armed-tool state: drawRequest is a *last* request rather than a current
// one (see MapStateProvider), so like every other UI here the Area button
// reads its lit state and icon off the shape on the map instead. Between
// arming a draw and closing the shape, it is not lit.
//
// Clear all is the last chip (see ActiveFilterChips); with only quick filters
// set there are no chips, so it closes this row instead.
export default function QuickFilters() {
  const { t } = useTranslation();
  const { requestDraw, zoom } = useMapState();
  const { polygon, onlyInView, setOnlyInView, inViewCount, realtimeCount } =
    useSelection();
  const { realtimeOnly, setRealtimeOnly } = useFilters();
  const { offerTip, tipHighlight } = useTips();
  const activeFilters = useActiveFilters();
  const onlyQuickFilters =
    activeFilters.length > 0 &&
    activeFilters.every((f) => QUICK_FILTER_KEYS.has(f.key));
  // Zoomed in to a local area, the whole-catalogue list stops matching the map.
  const zoomedIn = isMarkerTier(zoom) && !onlyInView;
  useEffect(() => {
    if (zoomedIn) offerTip("inView");
  }, [zoomedIn, offerTip]);

  const areaMenuId = useId();
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
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: onlyInView })}
        data-testid="quick-filter-in-view"
        data-tip-highlight={tipHighlight("inView")}
        onClick={() => setOnlyInView(!onlyInView)}
        aria-pressed={onlyInView}
        title={t("quickFilterInViewTitle")}
        aria-label={t("datasetsCardOnlyInViewText")}
      >
        <Eye size={14} aria-hidden="true" />
        <span
          className="quickFilterCount"
          data-testid="quick-filter-in-view-count"
        >
          {t("quickFilterCount", { count: inViewCount })}
        </span>
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCountedInView")}
        </span>
      </button>
      <span className="quickFilterDot" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: realtimeOnly })}
        data-testid="quick-filter-realtime"
        onClick={() => setRealtimeOnly(!realtimeOnly)}
        aria-pressed={realtimeOnly}
        title={t("quickFilterRealtimeTitle")}
        aria-label={t("realtimeFilterOptionText")}
      >
        <BroadcastPin size={14} aria-hidden="true" />
        <span
          className="quickFilterCount"
          data-testid="quick-filter-realtime-count"
        >
          {t("quickFilterCount", { count: realtimeCount })}
        </span>
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCountedRealtime")}
        </span>
      </button>
      <span className="quickFilterDot" aria-hidden="true">
        ·
      </span>
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
          data-tip-highlight={tipHighlight("reshapeArea")}
          onClick={() => setAreaMenuOpen(!areaMenuOpen)}
          aria-expanded={areaMenuOpen}
          aria-controls={areaMenuOpen ? areaMenuId : undefined}
          title={t("quickFilterAreaTitle")}
          aria-label={t("spatialFilterFilterName")}
        >
          {polygonActive ? (
            <Pentagon size={14} aria-hidden="true" />
          ) : (
            <BoundingBox size={14} aria-hidden="true" />
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
      {onlyQuickFilters && (
        <ClearAllFiltersButton className="quickFiltersClearAll" />
      )}
    </div>
  );
}
