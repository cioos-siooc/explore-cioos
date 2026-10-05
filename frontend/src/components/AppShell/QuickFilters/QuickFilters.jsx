import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowCounterclockwise,
  BoundingBox,
  BroadcastPin,
  Eye,
  Pentagon,
  Search,
  Trash,
  X,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { polygonIsRectangle } from "../../../utilities.jsx";
import { isMarkerTier } from "../../config.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import useResetAllFilters from "../../../state/useResetAllFilters.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The quick filters: the one-click ones that act on the map or are a single
// toggle rather than a list of options, as round buttons floating under the top bar.
//
// Search opens the search palette (see FilterSearch), which reaches every
// filter, this row's included.
//
// They used to be scattered — search and the two draw tools behind an unlabeled
// caret on the Filters segment, "only in view" hidden inside the parentheses of
// the count readout — and each also appeared as a chip below and as a row in
// the Filters modal. One control, three homes. This row is the one home: they
// are no longer in useActiveFilters (so the Filters badge counts only what the
// modal it sits on can change) and no longer rows in that modal.
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
// the title, and an icon alone was a guess.
//
// Show/Hide for this row and the active-filter chips beneath it (see
// TopControls) lives on the main Filters button instead of here — one toggle
// for both rather than each keeping its own. The reset button is one for
// both rows — quick filters and the modal ones the chips show alike — rather
// than a second button next to it clearing only half of what is set.
export default function QuickFilters() {
  const { t } = useTranslation();
  const { requestDraw, zoom } = useMapState();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();
  const { realtimeOnly, setRealtimeOnly } = useFilters();
  const { openFilterSearch } = useUI();
  const [canReset, resetAll] = useResetAllFilters();
  const { offerTip, tipHighlight } = useTips();
  // Zoomed in to a local area, the whole-catalogue list stops matching the map.
  const zoomedIn = isMarkerTier(zoom) && !onlyInView;
  useEffect(() => {
    if (zoomedIn) offerTip("inView");
  }, [zoomedIn, offerTip]);

  const labelId = useId();
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
      aria-labelledby={labelId}
      data-testid="quick-filters"
    >
      <span id={labelId} className="quickFiltersLabel">
        <span className="quickFiltersLabelText">
          {t("topBarQuickFiltersLabel")}
        </span>
      </span>
      {/* The search palette (see FilterSearch) covers titles as well as every
          other filter, so this opens it rather than keeping a title-only field
          of its own. A published title term stays named here, as nothing else
          on screen does: the chips leave the quick filters out. */}
      <div
        className={classNames("quickFilterSearch", {
          expanded: Boolean(datasetTitleSearchText),
        })}
      >
        <button
          type="button"
          className={classNames("quickFilterButton", {
            applied: Boolean(datasetTitleSearchText),
          })}
          data-testid="quick-filter-search"
          onClick={() => openFilterSearch(datasetTitleSearchText)}
          aria-haspopup="dialog"
          title={t("filterSearchOpenTitle")}
          aria-label={t("filterSearchOpenTitle")}
        >
          <Search size={18} aria-hidden="true" />
          <span className="quickFilterCaption" aria-hidden="true">
            {t("quickFilterCaptionSearch")}
          </span>
        </button>
        {datasetTitleSearchText && (
          <>
            <button
              type="button"
              className="quickFilterSearchTerm"
              data-testid="quick-filter-search-term"
              onClick={() => openFilterSearch(datasetTitleSearchText)}
              aria-haspopup="dialog"
              title={t("quickFilterSearchEditTitle", {
                term: datasetTitleSearchText,
              })}
            >
              “{datasetTitleSearchText}”
            </button>
            <button
              type="button"
              className="quickFilterSearchClear"
              data-testid="quick-filter-search-clear"
              onClick={() => setDatasetTitleSearchText("")}
              title={t("filterClearSearchTitle")}
              aria-label={t("filterClearSearchTitle")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
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
      >
        <Eye size={18} aria-hidden="true" />
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionInView")}
        </span>
      </button>
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: realtimeOnly })}
        data-testid="quick-filter-realtime"
        onClick={() => setRealtimeOnly(!realtimeOnly)}
        aria-pressed={realtimeOnly}
        title={t("quickFilterRealtimeTitle")}
        aria-label={t("realtimeFilterOptionText")}
      >
        <BroadcastPin size={18} aria-hidden="true" />
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionRealtime")}
        </span>
      </button>
      {/* One reset for everything this row and the chips below can set —
          quick filters and the modal ones alike — rather than two buttons
          each clearing half of it. Disabled rather than removed while
          nothing is set, so the row keeps its shape. */}
      <button
        type="button"
        className="quickFilterButton quickFilterReset"
        data-testid="quick-filter-reset"
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
