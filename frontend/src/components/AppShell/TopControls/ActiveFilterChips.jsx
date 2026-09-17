import * as React from "react";
import { useState } from "react";
import { Eye, EyeSlash, X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { generateRangeSelectBadgeTitle } from "../../../utilities.jsx";
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
} from "../../config.js";
import {
  DATA_LAYER_LABEL_KEYS,
  selectedDataLayerKeys,
} from "../../../state/dataLayers.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";

// Maps each active-filter group key to the filterName FiltersPanel opens it
// under (see FiltersPanel.jsx — most groups key off a stable i18n key, but
// time/depth key off their own translated label, so those two are computed
// with t() rather than hardcoded).
function filterNameForKey(key, t) {
  switch (key) {
    case "eovs":
      return "oceanVariablesFiltername";
    case "platforms":
      return "platformsFilterName";
    case "orgs":
      return "organizationFilterName";
    case "datasets":
      return "datasetsFilterName";
    case "sources":
      return "sourceFilterName";
    case "time":
      return t("timeframeFilterName");
    case "depth":
      return t("depthRangeFilterName");
    case "scientificName":
      return "scientificNameFilterName";
    case "dataLayers":
      return "layerSelectorLabel";
    default:
      return undefined;
  }
}

// Removable chips for every filter currently constraining the map, flowing
// after the Filters button, under a centered heading, a small legend for its
// two pill colours, and the Show/Hide and Clear-all actions. Each group shows
// its own name in a white bubble on the left — paired with the button that
// clears the whole group — braced against its chosen values in primary-light
// chips wrapping on the right. Clicking the name jumps to that filter's page
// (the Filters modal, or the datasets sidebar for the text search), and each
// value can still be dropped on its own.
export default function ActiveFilterChips() {
  const { t } = useTranslation();
  const {
    buildActiveFilters,
    resetFilters,
    startDate,
    endDate,
    startDepth,
    endDepth,
  } = useFilters();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();
  const { setShowFiltersModal, setOpenFilter, setSidebarOpen } = useUI();
  const { dataLayers, toggleDataLayer, resetDataLayers, requestDraw } =
    useMapState();

  // What is filtering the map, at every width. The chips used to start
  // collapsed on phones, on the reasoning that they would eat the map — but
  // they are the only thing on screen that says which filters are on, and a
  // filtered map with nothing saying so is worse than a smaller one. The
  // Show/Hide toggle below is still here for putting them away by hand; it is
  // no longer the screen size's decision to make.
  const [collapsed, setCollapsed] = useState(false);

  const timeframesBadgeTitle = generateRangeSelectBadgeTitle(
    t("timeframeFilterName"),
    [startDate, endDate],
    [defaultStartDate, defaultEndDate],
  );
  const depthRangeBadgeTitle = generateRangeSelectBadgeTitle(
    t("depthRangeFilterName"),
    [startDepth, endDepth],
    [defaultStartDepth, defaultEndDepth],
    "(m)",
  );

  // The geometry selection, announced the same way every other filter's is: one
  // item per chosen value, and nothing at all while the filter is unfiltered
  // (every geometry drawn). Dropping an item unticks that geometry; dropping
  // the last one returns to all, via commitDataLayers.
  const chosenDataLayers = selectedDataLayerKeys(dataLayers);
  const dataLayersFilter = chosenDataLayers.length > 0 && {
    key: "dataLayers",
    label: t("layerSelectorLabel"),
    removeAll: resetDataLayers,
    items: chosenDataLayers.map((key) => ({
      id: key,
      label: t(DATA_LAYER_LABEL_KEYS[key]),
      remove: () => toggleDataLayer(key),
    })),
  };

  const activeFilters = [
    dataLayersFilter,
    ...buildActiveFilters({ timeframesBadgeTitle, depthRangeBadgeTitle }),
    datasetTitleSearchText && {
      key: "search",
      label: t("textSearchFilterName"),
      goToFilter: () => setSidebarOpen(true),
      removeAll: () => setDatasetTitleSearchText(""),
      items: [
        {
          id: "search",
          label: datasetTitleSearchText,
          remove: () => setDatasetTitleSearchText(""),
        },
      ],
    },
    onlyInView && {
      key: "onlyInView",
      label: t("datasetsCardOnlyInViewText"),
      goToFilter: () => {
        setOpenFilter(t("datasetsCardOnlyInViewText"));
        setShowFiltersModal(true);
      },
      removeAll: () => setOnlyInView(false),
      items: [
        {
          id: "onlyInView",
          label: t("datasetsCardOnlyInViewChipText"),
          remove: () => setOnlyInView(false),
        },
      ],
    },
  ]
    .filter(Boolean)
    .map((f) => ({
      ...f,
      goToFilter:
        f.goToFilter ||
        (() => {
          setOpenFilter(filterNameForKey(f.key, t));
          setShowFiltersModal(true);
        }),
    }));

  if (activeFilters.length === 0 && !polygon) return null;

  return (
    <div className="activeFiltersPanel" data-testid="active-filter-chips">
      <div className="activeFiltersHeader">
        <div className="activeFiltersTitleCard">
          <span className="activeFiltersHeading" id="activeFiltersHeading">
            {t("activeFiltersLabel")}
          </span>
          <div className="activeFiltersLegend">
            <span className="activeFiltersLegendItem">
              <span
                className="activeFiltersLegendSwatch activeFiltersLegendSwatchFamily"
                aria-hidden="true"
              />
              {t("activeFiltersLegendFamily")}
            </span>
            <span className="activeFiltersLegendItem">
              <span
                className="activeFiltersLegendSwatch activeFiltersLegendSwatchValue"
                aria-hidden="true"
              />
              {t("activeFiltersLegendValue")}
            </span>
            <span className="activeFiltersLegendDivider" aria-hidden="true" />
            {/* Show/Hide and Clear-all, as symbols inline with the legend
                rather than a worded row of their own — icon-only, so each
                carries its accessible name on the button itself. */}
            <button
              type="button"
              className="activeFiltersToggleButton"
              data-testid="filter-chips-toggle"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              aria-label={
                collapsed ? t("activeFiltersShow") : t("activeFiltersHide")
              }
              title={
                collapsed ? t("activeFiltersShow") : t("activeFiltersHide")
              }
            >
              {collapsed ? (
                <Eye size={16} aria-hidden="true" />
              ) : (
                <EyeSlash size={16} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="activeFiltersClearButton"
              data-testid="filter-chips-reset"
              onClick={() => {
                resetFilters();
                resetDataLayers();
                requestDraw("clear");
                setDatasetTitleSearchText("");
              }}
              aria-label={t("resetFiltersButtonTooltipText")}
              title={t("resetFiltersButtonTooltipText")}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <ul
        className="activeFilterBullets"
        aria-labelledby="activeFiltersHeading"
      >
        {!collapsed &&
          activeFilters.map((f) => (
            <li
              key={f.key}
              className="activeFilterGroup"
              data-testid="filter-chip-group"
              data-filter-key={f.key}
            >
              {/* The group's own name, and the button that clears all of it —
                  paired in one white bubble so the type reads as a tag rather
                  than another chip among the values. Anchored on the left; a
                  brace links it to the values wrapping on the right, the way
                  set notation writes "family { values }". */}
              <div className="activeFilterGroupBubble">
                <button
                  type="button"
                  className="activeFilterGroupRemove"
                  data-testid="filter-chip-group-remove"
                  aria-label={t("activeFilterRemoveAllTitle", {
                    filter: f.label,
                  })}
                  onClick={f.removeAll}
                  title={t("activeFilterRemoveAllTitle", { filter: f.label })}
                >
                  <X size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="activeFilterGroupLabel"
                  data-testid="filter-chip-label"
                  onClick={f.goToFilter}
                  title={t("activeFilterGoToFilterTitle", { filter: f.label })}
                >
                  {f.label}
                </button>
              </div>
              {/* A crisp square bracket, drawn in CSS rather than a hand-tuned
                  curve: its height is just its box's height (see styles.css),
                  so it always spans exactly as tall as the values wrap to,
                  with no risk of the curve pointing the wrong way. */}
              <span className="activeFilterGroupBrace" aria-hidden="true" />
              <div className="activeFilterItems">
                {f.items.map((item) => (
                  <span
                    key={item.id}
                    className="activeFilterItem"
                    data-testid="filter-chip-item"
                    data-item-id={item.id}
                  >
                    <span className="activeFilterItemLabel" title={item.label}>
                      {item.label}
                    </span>
                    <button
                      type="button"
                      className="activeFilterItemRemove"
                      data-testid="filter-chip-item-remove"
                      onClick={item.remove}
                      title={t("activeFilterRemoveItemTitle")}
                      // Every chip's X carried the same accessible name, so
                      // "Remove filter" matched all of them at once — ambiguous for
                      // a test and useless to a screen reader reading the page's
                      // buttons. Composed here rather than as a new i18n key.
                      aria-label={`${t("activeFilterRemoveItemTitle")}: ${item.label}`}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            </li>
          ))}
        {!collapsed && polygon && (
          <li
            className="activeFilterGroup"
            data-testid="filter-chip-group"
            data-filter-key="polygon"
          >
            <div className="activeFilterItems">
              <span className="activeFilterItem" data-testid="filter-chip-item">
                <span className="activeFilterItemLabel">
                  {t("chipMapSelectionLabel")}
                </span>
                <button
                  type="button"
                  className="activeFilterItemRemove"
                  data-testid="filter-chip-item-remove"
                  onClick={() => requestDraw("clear")}
                  title={t("activeFilterRemoveItemTitle")}
                  aria-label={`${t("activeFilterRemoveItemTitle")}: ${t("chipMapSelectionLabel")}`}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
