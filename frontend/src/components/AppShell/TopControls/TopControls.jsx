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
import DatasetCounts from "./DatasetCounts.jsx";
import DatasetMapCard from "../DatasetMapCard/DatasetMapCard.jsx";
import QuickFilters from "../QuickFilters/QuickFilters.jsx";
import TopBarRow from "./TopBarRow.jsx";
import usePublishedFootprint from "../../../state/ui/usePublishedFootprint.js";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import useActiveFilters from "../../../state/useActiveFilters.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

// Half the shell's usual 12px inset: on narrow viewports it comes straight off
// the left column, whose height is already spoken for.
const TOP_BAR_GAP = 6;

// Measured, not fixed: the bar grows downward as chips wrap and overhangs the
// left column on narrower viewports (0 once the screen is wide enough).
function measureTopBarSpace(rect) {
  const column = document.querySelector(".sidebar")?.getBoundingClientRect();
  if (column && rect.left >= column.right) return 0;
  return rect.bottom + TOP_BAR_GAP;
}

// The quick filters and chips sit on the map under the card; they fold away
// with the chevron on the Filters segment, which already names filter state.
export default function TopControls() {
  const { t } = useTranslation();
  // The same list the chips render, so the badge can't disagree with them.
  const activeFilterCount = useActiveFilters().length;
  const {
    showFiltersModal,
    openFilters,
    showCoverageModal,
    setShowCoverageModal,
    sidebarOpen,
    setSidebarOpen,
    quickFiltersCollapsed,
    setQuickFiltersCollapsed,
  } = useUI();
  const { inspectDataset } = useSelection();
  const { tipHighlight } = useTips();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  // The quick filters act on the whole catalogue, so they give way while the
  // map is keyed to one minimized dataset.
  const datasetMinimized = Boolean(inspectDataset) && !sidebarOpen;

  const barRef = useRef(null);
  // The column widens beside an open dataset page.
  usePublishedFootprint(
    barRef,
    "--cioos-top-bar-space",
    measureTopBarSpace,
    ".sidebar",
  );

  return (
    <div
      className={classNames("topBar", { besideSidebar: sidebarOpen })}
      ref={barRef}
      data-testid="top-bar"
    >
      <BrandSearch>
        <div className="topBarStatusRow">
          <DatasetCounts />
        </div>
        <div className="topBarActions" data-testid="top-bar-actions">
          <button
            type="button"
            className={classNames("topBarButton", { active: sidebarOpen })}
            data-testid="topbar-datasets-button"
            // A minimized dataset page comes back as it was left.
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
            // "Time coverage", because "Time" already names the time filter's
            // chip, which can be on screen at the same moment.
            title={t("coverageButtonTitle")}
          >
            <BarChartLine size={18} aria-hidden="true" />
            <span className="topBarButtonLabel">
              {t("topBarCoverageLabel")}
            </span>
          </button>
          <div
            className={classNames("topBarButton topBarFiltersSegment", {
              // Once closed, applied filters keep the lighter "applied" wash.
              active: showFiltersModal,
              applied: !showFiltersModal && activeFilterCount > 0,
            })}
          >
            <button
              type="button"
              className="topBarFiltersOpen"
              data-testid="topbar-filters-button"
              onClick={openFilters}
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
      <TopBarRow
        contentKey={
          datasetMinimized
            ? isMobile
              ? "dataset"
              : null
            : quickFiltersCollapsed
              ? null
              : "filters"
        }
      >
        {datasetMinimized ? (
          isMobile && <DatasetMapCard dataset={inspectDataset} />
        ) : (
          <QuickFilters />
        )}
      </TopBarRow>
      <TopBarRow contentKey={quickFiltersCollapsed ? null : "chips"}>
        <ActiveFilterChips />
      </TopBarRow>
    </div>
  );
}
