import * as React from "react";
import { useEffect, useRef } from "react";
import {
  ChevronCompactDown,
  ChevronCompactUp,
  X,
  BoxArrowUpRight,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { abbreviateString, useSearchInput } from "../../../utilities";

import { useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

// One row of the Filters panel's list; its page opens beside the list while
// `openFilter` (the panel's single open page, kept in the URL) names it.
export default function Filter({
  active,
  badgeTitle,
  tooltip,
  // Greyed rather than hidden so rows don't come and go from the list.
  disabled,
  disabledTooltip,
  icon,
  openFilter,
  setOpenFilter,
  filterName,
  searchable,
  searchTerms,
  setSearchTerms,
  searchPlaceholder,
  resetButton,
  infoButton,
  tipTarget,
  // Above the scrolling options, so a long list can't scroll it away.
  controls,
  // Below them, likewise always in view.
  legend,
  children,
}) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();

  // Debounced: the search re-filters a list thousands of options long.
  const [searchText, setSearchText, submitSearch] = useSearchInput(
    searchTerms ?? "",
    setSearchTerms,
  );

  const isOpen = Boolean(openFilter);
  const paneShown = isOpen && !disabled;

  // Picking a searchable row puts the cursor in its search, as the next thing
  // to do; a page restored from a link leaves focus where the modal put it.
  const searchRef = useRef(null);
  const focusSearch = useRef(false);
  useEffect(() => {
    if (!paneShown || !focusSearch.current) return;
    focusSearch.current = false;
    searchRef.current?.focus();
  }, [paneShown]);

  const filterButton = (
    <button
      data-testid="filter-header"
      className={`filterHeader ${active && !disabled ? "active" : ""} ${
        isOpen ? "open" : ""
      } ${disabled ? "disabled" : ""}`}
      aria-current={isOpen ? "true" : undefined}
      // Not `disabled`: that would drop pointer events on the explained row.
      aria-disabled={disabled ? "true" : undefined}
      onClick={() => {
        if (disabled || isOpen) return;
        focusSearch.current = true;
        setOpenFilter(filterName);
      }}
    >
      {icon}
      <div className="badgeTitle" title={badgeTitle}>
        {abbreviateString(badgeTitle, 35)}
      </div>
      {isOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
    </button>
  );

  return (
    <div className="filter" data-testid="filter" data-filter-name={filterName}>
      {filterButton}
      {disabled && (disabledTooltip || tooltip) && (
        <div className="filterCaption">{disabledTooltip || tooltip}</div>
      )}
      {paneShown && (
        <div className="filterOptions" data-testid="filter-options">
          <div className="filterOptionsHeader">
            <h3 className="filterOptionsTitle">{t(filterName)}</h3>
            {/* Only once there is something to clear. */}
            {resetButton && active && (
              <button
                type="button"
                className="filterOptionsReset"
                onClick={() => resetButton()}
              >
                {t("resetButtonText")}
              </button>
            )}
          </div>
          {tooltip && <div className="filterOptionsCaption">{tooltip}</div>}
          {/* Wrapped so the clear button positions against the field, not the
              pane (whose caption has unpredictable height). */}
          {searchable && (
            // A form, so Enter skips the debounce.
            <form
              className="filterSearchRow"
              data-tip-highlight={tipHighlight(tipTarget)}
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch();
              }}
            >
              <input
                ref={searchRef}
                className="filterSearch"
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={searchPlaceholder}
              />
              {searchText && (
                <button
                  type="button"
                  className="clearFilter"
                  onClick={() => setSearchText("")}
                  title={t("filterClearSearchTitle")}
                  aria-label={t("filterClearSearchTitle")}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              )}
            </form>
          )}
          {controls && <div className="filterOptionsControls">{controls}</div>}
          <div className="filterOptionsBody">{children}</div>
          {legend}
          {/* No Select all: an explicit all-list would exclude records with
              no value and options harvested later; empty already means all. */}
          {infoButton && (
            <div className="filterOptionsActions">
              {infoButton && (
                <a
                  className="filterInfoButton"
                  href={infoButton}
                  target="_blank"
                  title={t("filterInfoButtonTitle")}
                  rel="noreferrer"
                >
                  Info&nbsp;
                  <BoxArrowUpRight
                    color="var(--cioos-primary-800)"
                    size={17.5}
                  />
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
