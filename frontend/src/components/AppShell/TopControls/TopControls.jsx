import * as React from "react";
import { useRef } from "react";
import { BarChartLine, Filter, ListUl } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import BrandSearch from "../TopLeft/BrandSearch.jsx";
import ActiveFilterChips from "./ActiveFilterChips.jsx";
import DatasetCounts from "./DatasetCounts.jsx";
import DatasetMapCard from "../DatasetMapCard/DatasetMapCard.jsx";
import QuickFilters from "../QuickFilters/QuickFilters.jsx";
import TopBarRow from "./TopBarRow.jsx";
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
// The quick filters (see QuickFilters) share the tally's strip, since that is
// the number they narrow. The active-filter chips flow beneath the card.
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
  } = useUI();
  const { inspectDataset } = useSelection();
  const { tipHighlight } = useTips();
  // A dataset page minimized to the map: the card naming it hangs under the
  // brand card.
  const datasetMinimized = Boolean(inspectDataset) && !sidebarOpen;

  const barRef = useRef(null);
  usePublishedFootprint(barRef, "--cioos-top-bar-space", measureTopBarSpace);

  return (
    <div className="topBar" ref={barRef} data-testid="top-bar">
      <BrandSearch>
        <div className="topBarStatusRow">
          <DatasetCounts />
          <QuickFilters />
        </div>
        <div className="topBarActions" data-testid="top-bar-actions">
          <button
            type="button"
            className={classNames("topBarButton", { active: sidebarOpen })}
            data-testid="topbar-datasets-button"
            // A minimized dataset page comes back as it was left; the page's
            // own Return to datasets is the way to the list.
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-pressed={sidebarOpen}
            title={
              sidebarOpen
                ? t("sidebarCollapseTitle")
                : inspectDataset
                  ? t("sidebarShowDatasetTitle")
                  : t("sidebarShowTitle")
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
            // at the same moment.
            title={t("coverageButtonTitle")}
          >
            <BarChartLine size={18} aria-hidden="true" />
            <span className="topBarButtonLabel">
              {t("topBarCoverageLabel")}
            </span>
          </button>
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
            <span className="topBarButtonLabel">{t("filtersMenuButton")}</span>
            {activeFilterCount > 0 && (
              <span className="topBarCount" data-testid="topbar-filter-count">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </BrandSearch>
      <TopBarRow contentKey={datasetMinimized ? "dataset" : null}>
        {datasetMinimized && <DatasetMapCard dataset={inspectDataset} />}
      </TopBarRow>
      <TopBarRow contentKey="chips">
        <ActiveFilterChips />
      </TopBarRow>
    </div>
  );
}
