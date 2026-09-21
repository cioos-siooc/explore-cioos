import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowCounterclockwise,
  BoundingBox,
  Eye,
  Pentagon,
  Search,
  X,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { polygonIsRectangle, useSearchInput } from "../../../utilities.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import "./styles.css";

// The quick filters: the four that act on the map rather than on a list of
// options, each one click, as round buttons floating under the top bar.
//
// They used to be scattered — search and the two draw tools behind an unlabeled
// caret on the Filters segment, "only in view" hidden inside the parentheses of
// the count readout — and each also appeared as a chip below and as a row in
// the Filters modal. One control, three homes. This row is the one home: they
// are no longer in useActiveFilters (so the Filters badge counts only what the
// modal it sits on can change) and no longer rows in that modal.
//
// No armed-tool state: drawRequest is a *last* request rather than a current
// one (see MapStateProvider), so like every other UI here the draw buttons read
// their pressed state off the shape on the map instead. Between arming a draw
// and closing the shape, neither is lit.
export default function QuickFilters() {
  const { t } = useTranslation();
  const { requestDraw } = useMapState();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();

  const searchInputId = useId();
  const inputRef = useRef(null);
  const searchButtonRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);

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
  const anySet = hasShape || onlyInView || Boolean(datasetTitleSearchText);

  // Arming the tool that is already drawn is how its shape is cleared — the
  // same second-click-to-leave the other two buttons here have.
  const draw = (mode, active) => requestDraw(active ? "clear" : mode);

  function closeSearch() {
    setSearchOpen(false);
    searchButtonRef.current?.focus();
  }

  return (
    <div
      className="quickFilters"
      role="group"
      aria-label={t("topBarQuickFiltersLabel")}
      data-testid="quick-filters"
    >
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
              : t("textSearchFilterName")
          }
          aria-label={
            searchExpanded
              ? t("filterSearchSubmitTitle")
              : t("textSearchFilterName")
          }
        >
          <Search size={18} aria-hidden="true" />
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
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: boxActive })}
        data-testid="quick-filter-box"
        onClick={() => draw("box", boxActive)}
        aria-pressed={boxActive}
        title={t("drawBoundingBoxOption")}
        aria-label={t("drawBoundingBoxOption")}
      >
        <BoundingBox size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: polygonActive })}
        data-testid="quick-filter-polygon"
        onClick={() => draw("polygon", polygonActive)}
        aria-pressed={polygonActive}
        title={t("drawPolygonOption")}
        aria-label={t("drawPolygonOption")}
      >
        <Pentagon size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: onlyInView })}
        data-testid="quick-filter-in-view"
        onClick={() => setOnlyInView(!onlyInView)}
        aria-pressed={onlyInView}
        title={t("datasetsCardOnlyInViewTitle")}
        aria-label={t("datasetsCardOnlyInViewText")}
      >
        <Eye size={18} aria-hidden="true" />
      </button>
      {/* Only these four. The chips panel's own Clear-all still resets
          everything, but it is only on screen while a modal filter is set — so
          with nothing but quick filters on, this is the one gesture that
          drops them all. */}
      {anySet && (
        <button
          type="button"
          className="quickFilterButton quickFilterReset"
          data-testid="quick-filter-reset"
          onClick={() => {
            requestDraw("clear");
            setDatasetTitleSearchText("");
            setOnlyInView(false);
            setSearchOpen(false);
          }}
          title={t("quickFiltersResetTitle")}
          aria-label={t("quickFiltersResetTitle")}
        >
          <ArrowCounterclockwise size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
