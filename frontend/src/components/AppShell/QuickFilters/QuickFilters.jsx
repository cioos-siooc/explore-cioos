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

import { polygonIsRectangle, useSearchInput } from "../../../utilities.jsx";
import { isMarkerTier } from "../../config.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import useActiveFilters from "../../../state/useActiveFilters.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import "./styles.css";

// The quick filters: the one-click ones that act on the map or are a single
// toggle rather than a list of options, as round buttons floating under the top bar.
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
  const { requestDraw, resetDataLayers, zoom } = useMapState();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();
  const activeFilterCount = useActiveFilters().length;
  const { resetFilters, realtimeOnly, setRealtimeOnly } = useFilters();
  const { offerTip, tipHighlight } = useTips();
  // Zoomed in to a local area, the whole-catalogue list stops matching the map.
  const zoomedIn = isMarkerTier(zoom) && !onlyInView;
  useEffect(() => {
    if (zoomedIn) offerTip("inView");
  }, [zoomedIn, offerTip]);

  const labelId = useId();
  const searchInputId = useId();
  const inputRef = useRef(null);
  const searchButtonRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
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

  // The hook lives here, in the row that is always mounted — not in the field,
  // which comes and goes with the expansion. Its cleanup publishes text that
  // hadn't been submitted yet (see useSearchInput), so mounted with the field
  // it would requery the whole map every time the field closed on an unsent
  // word. Up here, collapsing keeps the draft and asks the map for nothing.
  const [searchText, setSearchText, submitSearch] = useSearchInput(
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    { trigger: "submit" },
  );

  // A published term holds the field open on its own: it is the only thing on
  // screen naming what the search is narrowing to, so it cannot be collapsed
  // out of sight. Clearing is what closes it.
  const searchExpanded = searchOpen || Boolean(datasetTitleSearchText);

  // On searchOpen, not on searchExpanded: a term arriving from a share link
  // opens the field too, and focusing it there would take the caret off
  // whatever the page loaded with. Only the button press asks for the caret.
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const hasShape = Boolean(polygon);
  const boxActive = hasShape && polygonIsRectangle(polygon);
  const polygonActive = hasShape && !boxActive;
  const anySet =
    hasShape || onlyInView || realtimeOnly || Boolean(datasetTitleSearchText);

  function chooseArea(mode) {
    requestDraw(mode);
    setAreaMenuOpen(false);
    areaButtonRef.current?.focus();
  }

  function closeSearch() {
    setSearchOpen(false);
    searchButtonRef.current?.focus();
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
      {/* A form, so Enter searches natively and the magnifier is that same
          submit rather than a second code path. Collapsed, that magnifier is
          instead the button that opens the field. */}
      <form
        className={classNames("quickFilterSearch", {
          expanded: searchExpanded,
        })}
        onSubmit={(e) => {
          e.preventDefault();
          submitSearch();
        }}
        onBlur={(e) => {
          // Empty and abandoned: close it up rather than leave an empty field
          // sitting open. A term already published keeps it open (see
          // searchExpanded), and focus moving to the clear/submit button
          // within this same form is not a departure.
          if (searchText || datasetTitleSearchText) return;
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setSearchOpen(false);
        }}
      >
        <button
          ref={searchButtonRef}
          type={searchExpanded ? "submit" : "button"}
          className={classNames("quickFilterButton", {
            applied: Boolean(datasetTitleSearchText),
          })}
          data-testid="quick-filter-search"
          onClick={searchExpanded ? undefined : () => setSearchOpen(true)}
          aria-expanded={searchExpanded}
          // Only while the field is really there: aria-controls pointing at an
          // element that isn't in the DOM is an axe violation, and the a11y
          // baseline is a ratchet (see e2e/support/axeBaseline.js).
          aria-controls={searchExpanded ? searchInputId : undefined}
          title={
            searchExpanded
              ? t("filterSearchSubmitTitle")
              : t("quickFilterSearchTitle")
          }
          aria-label={
            searchExpanded
              ? t("filterSearchSubmitTitle")
              : t("textSearchFilterName")
          }
        >
          <Search size={18} aria-hidden="true" />
          <span className="quickFilterCaption" aria-hidden="true">
            {t("quickFilterCaptionSearch")}
          </span>
        </button>
        {searchExpanded && (
          <>
            <input
              ref={inputRef}
              id={searchInputId}
              type="text"
              className="quickFilterSearchInput"
              data-testid="quick-filter-search-input"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                // On the published term, not the box's contents: a draft can be
                // tucked away (the hook holds it, and it comes back on the way
                // in), but a term that is actually narrowing the map is the
                // only thing on screen naming it, so it cannot be hidden.
                if (!datasetTitleSearchText) closeSearch();
              }}
              placeholder={t("textSearchFilterPlaceholder")}
              aria-label={t("textSearchFilterName")}
            />
            {searchText && (
              <button
                type="button"
                className="quickFilterSearchClear"
                data-testid="quick-filter-search-clear"
                // Emptying publishes immediately (see useSearchInput), so this
                // drops the filter as well as the text.
                onClick={() => {
                  setSearchText("");
                  closeSearch();
                }}
                title={t("filterClearSearchTitle")}
                aria-label={t("filterClearSearchTitle")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </form>
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
        disabled={!anySet && activeFilterCount === 0}
        onClick={() => {
          resetFilters();
          resetDataLayers();
          requestDraw("clear");
          setDatasetTitleSearchText("");
          setOnlyInView(false);
          setSearchOpen(false);
        }}
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
