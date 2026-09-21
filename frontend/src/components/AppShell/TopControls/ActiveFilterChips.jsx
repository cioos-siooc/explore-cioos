import * as React from "react";
import { useState } from "react";
import { X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import useActiveFilters from "../../../state/useActiveFilters.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";

// How many values a group shows before folding the rest behind a "+N" chip —
// short enough that a group's own values stay on the one row its label pill
// sits on, rather than sprawling the row over several lines. Clicking the
// chip reveals the rest of that group (and only that group); there is no way
// back short of the row's own Show/Hide, since collapsing one group again is
// not something the map state needs to remember.
const MAX_VISIBLE_VALUES = 3;

// Removable chips for every filter currently constraining the map (see
// useActiveFilters — the same list the Filters badge counts), flowing under
// the quick-filter buttons as the next line of the same floating toolbar
// rather than a boxed panel of its own: one flat wrapping row of pills, no
// enclosing card. Each group's name is its own small pill — paired with the
// button that clears the whole group — immediately followed by its chosen
// values as lighter pills. Clicking the name jumps to that filter's page (the
// Filters modal, or the datasets sidebar for the text search), and each value
// can still be dropped on its own. Show/Hide and Clear-all live with the
// quick filters instead of here (see QuickFilters) — one toggle for both rows
// rather than each keeping its own.
export default function ActiveFilterChips() {
  const { t } = useTranslation();
  const activeFilters = useActiveFilters();
  const { filterChipsCollapsed } = useUI();

  // Which groups have had their "+N" chip clicked already — a group's key
  // stays in here even if its values change afterwards, since re-folding a
  // group the user already opened would be a surprise, not a convenience.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const expandGroup = (key) =>
    setExpandedGroups((prev) => new Set(prev).add(key));

  if (activeFilters.length === 0 || filterChipsCollapsed) return null;

  return (
    <ul
      className="activeFiltersPanel"
      data-testid="active-filter-chips"
      aria-label={t("activeFiltersLabel")}
    >
      {activeFilters.map((f) => {
        const expanded = expandedGroups.has(f.key);
        const shownItems = expanded
          ? f.items
          : f.items.slice(0, MAX_VISIBLE_VALUES);
        const hiddenCount = f.items.length - shownItems.length;

        return (
          <li
            key={f.key}
            className="activeFilterGroup"
            data-testid="filter-chip-group"
            data-filter-key={f.key}
          >
            {/* The group's own name, and the button that clears all of it —
                  paired in one small pill so the type reads as a tag rather
                  than another chip among the values, immediately followed by
                  those values in the same flowing row. */}
            <span className="activeFilterGroupBubble">
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
            </span>
            {shownItems.map((item) => (
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
            {hiddenCount > 0 && (
              <button
                type="button"
                className="activeFilterMoreButton"
                data-testid="filter-chip-more"
                onClick={() => expandGroup(f.key)}
                title={t("activeFilterShowMoreTitle", { count: hiddenCount })}
                aria-label={t("activeFilterShowMoreTitle", {
                  count: hiddenCount,
                })}
              >
                +{hiddenCount}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
