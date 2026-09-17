import * as React from "react";
import { useRef } from "react";
import { BarChartLine, Filter, ListUl } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import BrandSearch from "../TopLeft/BrandSearch.jsx";
import ActiveFilterChips from "./ActiveFilterChips.jsx";
import SingleDatasetView from "./SingleDatasetView.jsx";
import DatasetCounts from "./DatasetCounts.jsx";
import QuickFiltersButton from "./QuickFiltersButton.jsx";
import usePublishedFootprint from "../../../state/ui/usePublishedFootprint.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
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
// Third layer, merged into a single segmented pill: three equal-width peers —
// Datasets (opens/closes the left datasets sidebar) and Coverage (opens the
// time-distribution histogram) are the two ways to look at the current
// selection, and Filters (opens the filters modal) is the one way to change
// it. Welded onto the end of Filters, and narrow enough to read as part of
// it, is the quick-filters caret: the two filters that act on the map rather
// than on a list of options (see QuickFiltersButton). Every segment carries a
// dimmed-primary wash so they read as the map's primary entry points. The
// active-filter chips flow beneath, staying centered.
export default function TopControls() {
  const { t } = useTranslation();
  const { activeFilterCount } = useFilters();
  const {
    showFiltersModal,
    setShowFiltersModal,
    setShowCoverageModal,
    sidebarOpen,
    setSidebarOpen,
  } = useUI();
  const { inspectDataset, returnToDatasetList } = useSelection();

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
            className="topBarButton"
            data-testid="topbar-coverage-button"
            onClick={() => setShowCoverageModal(true)}
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
          {/* Filters and its caret share the third of the row's three equal
              columns, rather than the caret taking a fourth column of its own
              — so the three peers stay the same width as each other and the
              caret comes out of Filters' own share. */}
          <div className="topBarFiltersGroup">
            <button
              type="button"
              className={classNames("topBarButton", {
                // Solid while the modal itself is open; once it's closed, any
                // applied filters keep the button in the lighter "applied"
                // wash instead of dropping all the way back to baseline.
                active: showFiltersModal,
                applied: !showFiltersModal && activeFilterCount > 0,
              })}
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
            <QuickFiltersButton />
          </div>
        </div>
      </BrandSearch>
      <ActiveFilterChips />
      {/* Last in the stack: the dataset the map is keyed to, and the way out
          of it. Only up while the datasets card — whose banner otherwise says
          this — is collapsed. */}
      <SingleDatasetView />
    </div>
  );
}
