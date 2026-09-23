import * as React from "react";
import { useRef } from "react";
import {
  BarChartLine,
  ChevronDown,
  ChevronUp,
  Filter,
  ListUl,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import BrandSearch from "../TopLeft/BrandSearch.jsx";
import ActiveFilterChips from "./ActiveFilterChips.jsx";
import SingleDatasetView from "./SingleDatasetView.jsx";
import DatasetCounts from "./DatasetCounts.jsx";
import QuickFilters from "../QuickFilters/QuickFilters.jsx";
import usePublishedFootprint from "../../../state/ui/usePublishedFootprint.js";
import useActiveFilters from "../../../state/useActiveFilters.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

// Gap held between the bottom of the top bar and whatever it pushes down. Half
// the 12px inset the shell uses elsewhere: this one is spent on every viewport
// narrow enough for the bar to reach over the left column, and it comes
// straight off the top of that column — where the datasets card and the
// griddap legend are stacked and the height is already spoken for.
const TOP_BAR_GAP = 6;

// How far down the top bar reaches over the datasets column on the left. The bar
// is centered and grows downward as active-filter chips wrap onto new rows, so
// with a few filters applied it hangs well below the brand card and over the top
// of that column — hence a measurement rather than a fixed clearance.
//
// It only reaches the column on narrower viewports: once the screen is wide
// enough for the centered bar to sit clear of it, this is 0 and the datasets
// card starts at the top of the map again.
function measureTopBarSpace(rect) {
  const column = document.querySelector(".sidebar")?.getBoundingClientRect();
  if (column && rect.left >= column.right) return 0;
  return rect.bottom + TOP_BAR_GAP;
}

// Centered top header. First layer: the brand bar. Second layer: the dataset
// tally (shown / in view / total), which is what the layer below acts on.
// Third layer, a single segmented pill of three equal-width peers — Datasets
// (opens/closes the left datasets sidebar) and Coverage (opens the
// time-distribution histogram) are the two ways to look at the current
// selection, and Filters (opens the filters modal) is the one way to change
// it. Every segment carries a dimmed-primary wash so they read as the map's
// primary entry points.
//
// Under the card, on the map rather than in it, the quick filters (see
// QuickFilters) — the ones that act on the map instead of on a list of
// options. The active-filter chips flow beneath those, staying centered.
// Both of those rows fold away together, toggled by the small chevron riding
// on the far side of the Filters segment: it reads as part of the button that
// already names the filter state, rather than a fourth control among the
// tools it hides.
export default function TopControls() {
  const { t } = useTranslation();
  // The same list the chips below render, so the badge can never report a
  // different number of filters than the row under it names.
  const activeFilterCount = useActiveFilters().length;
  const {
    showFiltersModal,
    setShowFiltersModal,
    showCoverageModal,
    setShowCoverageModal,
    sidebarOpen,
    setSidebarOpen,
    quickFiltersCollapsed,
    setQuickFiltersCollapsed,
  } = useUI();
  const { inspectDataset, returnToDatasetList } = useSelection();
  const { tipHighlight } = useTips();

  const barRef = useRef(null);
  usePublishedFootprint(barRef, "--cioos-top-bar-space", measureTopBarSpace);

  return (
    <div className="topBar" ref={barRef} data-testid="top-bar">
      <BrandSearch>
        <DatasetCounts />
        <div className="topBarActions" data-testid="top-bar-actions">
          <button
            type="button"
            className={classNames("topBarButton", { active: sidebarOpen })}
            data-testid="topbar-datasets-button"
            onClick={() => {
              if (inspectDataset) returnToDatasetList();
              setSidebarOpen(!sidebarOpen);
            }}
            aria-pressed={sidebarOpen}
            title={
              sidebarOpen ? t("sidebarCollapseTitle") : t("sidebarShowTitle")
            }
          >
            <ListUl size={18} aria-hidden="true" />
            <span className="topBarButtonLabel">
              {t("topBarDatasetsLabel")}
            </span>
          </button>
          <button
            type="button"
            className={classNames("topBarButton", {
              active: showCoverageModal,
            })}
            data-testid="topbar-coverage-button"
            data-tip-highlight={tipHighlight("timeCoverage")}
            onClick={() => setShowCoverageModal(true)}
            aria-pressed={showCoverageModal}
            // "Time coverage", not the "Time" the label would otherwise want
            // to be: that is already the time *filter's* own name
            // (timeframeFilterName), and it names a chip that can be on screen
            // at the same moment. The feature's full name — also the modal's
            // title — stays on the accessible name and the tooltip.
            aria-label={t("coverageButton")}
            title={t("coverageButtonTitle")}
          >
            <BarChartLine size={18} aria-hidden="true" />
            <span className="topBarButtonLabel">
              {t("topBarCoverageLabel")}
            </span>
          </button>
          <div
            className={classNames("topBarButton topBarFiltersSegment", {
              // Solid while the modal itself is open; once it's closed, any
              // applied filters keep the button in the lighter "applied"
              // wash instead of dropping all the way back to baseline.
              active: showFiltersModal,
              applied: !showFiltersModal && activeFilterCount > 0,
            })}
          >
            <button
              type="button"
              className="topBarFiltersOpen"
              data-testid="topbar-filters-button"
              onClick={() => setShowFiltersModal(true)}
              aria-pressed={showFiltersModal}
              title={t("dockFiltersCountTitle", { count: activeFilterCount })}
            >
              <Filter size={18} aria-hidden="true" />
              <span className="topBarButtonLabel">
                {t("filtersMenuButton")}
              </span>
              {activeFilterCount > 0 && (
                <span className="topBarCount" data-testid="topbar-filter-count">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {/* Show/Hide for the quick-filter row and the active-filter
                chips beneath it (see QuickFilters, ActiveFilterChips) — one
                toggle for both, riding on the button that already names
                whether any filter is set. */}
            <button
              type="button"
              className="topBarFiltersToggle"
              data-testid="quick-filters-toggle"
              onClick={() =>
                setQuickFiltersCollapsed((collapsed) => !collapsed)
              }
              aria-expanded={!quickFiltersCollapsed}
              aria-label={
                quickFiltersCollapsed
                  ? t("quickFiltersShow")
                  : t("quickFiltersHide")
              }
              title={
                quickFiltersCollapsed
                  ? t("quickFiltersShow")
                  : t("quickFiltersHide")
              }
            >
              {quickFiltersCollapsed ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronUp size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </BrandSearch>
      {!quickFiltersCollapsed && (
        <>
          <QuickFilters />
          <ActiveFilterChips />
        </>
      )}
      {/* Last in the stack: the dataset the map is keyed to, and the way out
          of it. Only up while the datasets card — whose banner otherwise says
          this — is collapsed. */}
      <SingleDatasetView />
    </div>
  );
}
