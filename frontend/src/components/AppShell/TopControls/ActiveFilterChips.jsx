import * as React from "react";
import { useState } from "react";
import { Eye, EyeSlash, X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import useActiveFilters from "../../../state/useActiveFilters.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

// Removable chips for every filter currently constraining the map (see
// useActiveFilters — the same list the Filters badge counts), flowing after the
// Filters button under a single header row: the legend for its two pill colours
// on the left, the heading centred, and the Show/Hide and Clear-all actions on
// the right. Each group shows its own name in a white bubble on the left —
// paired with the button that clears the whole group — braced against its
// chosen values in primary-light chips wrapping on the right. Clicking the name
// jumps to that filter's page (the Filters modal, or the datasets sidebar for
// the text search), and each value can still be dropped on its own.
export default function ActiveFilterChips() {
  const { t } = useTranslation();
  const activeFilters = useActiveFilters();
  const { resetFilters } = useFilters();
  const { setDatasetTitleSearchText, setOnlyInView } = useSelection();
  const { resetDataLayers, requestDraw } = useMapState();

  // What is filtering the map, at every width. The chips used to start
  // collapsed on phones, on the reasoning that they would eat the map — but
  // they are the only thing on screen that says which filters are on, and a
  // filtered map with nothing saying so is worse than a smaller one. The
  // Show/Hide toggle is still here for putting them away by hand; it is no
  // longer the screen size's decision to make.
  const [collapsed, setCollapsed] = useState(false);

  if (activeFilters.length === 0) return null;

  return (
    <div className="activeFiltersPanel" data-testid="active-filter-chips">
      <div className="activeFiltersTitleCard">
        {/* Heading first in the DOM so it is read before the legend that
              explains the chips below it; the grid columns put the legend to
              its left. */}
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
        </div>
        {/* Show/Hide and Clear-all, as symbols rather than a worded row —
              icon-only, so each carries its accessible name on the button. */}
        <div className="activeFiltersActions">
          <button
            type="button"
            className="activeFiltersToggleButton"
            data-testid="filter-chips-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={
              collapsed ? t("activeFiltersShow") : t("activeFiltersHide")
            }
            title={collapsed ? t("activeFiltersShow") : t("activeFiltersHide")}
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
              setOnlyInView(false);
            }}
            aria-label={t("resetFiltersButtonTooltipText")}
            title={t("resetFiltersButtonTooltipText")}
          >
            <X size={20} aria-hidden="true" />
          </button>
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
      </ul>
    </div>
  );
}
