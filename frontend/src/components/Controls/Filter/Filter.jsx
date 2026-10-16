import * as React from "react";
import { useRef, useState } from "react";
import {
  ChevronCompactDown,
  ChevronCompactUp,
  X,
  BoxArrowUpRight,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import {
  abbreviateString,
  useChanged,
  useOutsideAlerter,
  useSearchInput,
} from "../../../utilities";

import { useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

export default function Filter({
  active,
  badgeTitle,
  tooltip,
  // Greyed rather than hidden so rows don't come and go from the list.
  disabled,
  disabledTooltip,
  icon,
  controlled,
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
  children,
}) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();

  const [filterOpen, setFilterOpen] = useState(controlled ? openFilter : false);
  const wrapperRef = useRef(null);
  useOutsideAlerter(wrapperRef, setFilterOpen, false);

  // Own state so an outside click can close a controlled Filter; mirrored
  // during render, not in an effect, so the two never disagree for a frame.
  if (useChanged(openFilter) && controlled) setFilterOpen(openFilter);

  // Debounced: the search re-filters a list thousands of options long.
  const [searchText, setSearchText, submitSearch] = useSearchInput(
    searchTerms ?? "",
    setSearchTerms,
  );

  const isOpen = filterOpen && (!controlled || Boolean(openFilter));
  const paneShown = isOpen && !disabled;

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
        if (disabled) return;
        setFilterOpen(!filterOpen);
        if (controlled) setOpenFilter(filterName);
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
    <div
      className="filter"
      ref={wrapperRef}
      data-testid="filter"
      data-filter-name={filterName}
    >
      {filterButton}
      {disabled && (disabledTooltip || tooltip) && (
        <div className="filterCaption">{disabledTooltip || tooltip}</div>
      )}
      {paneShown && (
        <div className="filterOptions" data-testid="filter-options">
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
                autoFocus
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
          <div className="filterOptionsBody">{children}</div>
          {/* No Select all: an explicit all-list would exclude records with
              no value and options harvested later; empty already means all. */}
          {(resetButton || infoButton) && (
            <div className="filterOptionsActions">
              {resetButton && (
                <button onClick={() => resetButton()}>
                  {t("resetButtonText")}
                </button>
              )}
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
                    color="var(--cioos-primary-700)"
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
