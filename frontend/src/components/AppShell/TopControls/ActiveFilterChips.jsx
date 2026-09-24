import * as React from "react";
import { useState } from "react";
import { X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import useActiveFilters from "../../../state/useActiveFilters.js";

// How many values a group shows before folding the rest behind a "+N" chip —
// short enough that a group's own values stay on the one row its label pill
// sits on, rather than sprawling the row over several lines. Clicking the
// chip reveals the rest of that group (and only that group); a second click
// on the button that replaces it (now reading "show fewer") folds it back.
const MAX_VISIBLE_VALUES = 2;

// Removable chips for every filter currently constraining the map (see
// useActiveFilters — the same list the Filters badge counts), flowing under
// the quick-filter buttons as the next line of the same floating toolbar
// rather than a boxed panel of its own: one flat wrapping row of pills, no
// enclosing card. Each group's name is its own small pill — paired with the
// button that clears the whole group — immediately followed by its chosen
// values as lighter pills. Clicking the name jumps to that filter's page (the
// Filters modal, or the datasets sidebar for the text search), and each value
// can still be dropped on its own. Show/Hide lives on the main Filters button
// instead of here (see TopControls) — one toggle for this row and the quick
// filters above it, rather than each keeping its own; Clear-all lives with
// the quick filters (see QuickFilters).
export default function ActiveFilterChips() {
  const { t } = useTranslation();
  const activeFilters = useActiveFilters();

  // Which groups currently show every value rather than the folded MAX_VISIBLE_VALUES —
  // toggled by the button at the end of the group's own row, so opening one
  // is exactly as reversible as closing it again.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (key) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (activeFilters.length === 0) return null;

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
                <span className="activeFilterGroupIcon" aria-hidden="true">
                  {f.icon}
                </span>
                <span className="activeFilterGroupLabelText">{f.label}</span>
              </button>
            </span>
            {shownItems.map((item) => {
              // Spelled out in full for the tooltip and the screen reader; the
              // chip shows the "not" as its own tag so it reads at a glance.
              const fullLabel = item.excluded
                ? t("filterExcludedOption", { title: item.label })
                : item.label;
              return (
                <span
                  key={item.id}
                  className={`activeFilterItem ${item.excluded ? "excluded" : ""}`}
                  data-testid="filter-chip-item"
                  data-item-id={item.id}
                  data-excluded={Boolean(item.excluded)}
                >
                  {item.excluded && (
                    <span className="activeFilterItemNot" aria-hidden="true">
                      {t("filterNotTag")}
                    </span>
                  )}
                  <span className="activeFilterItemLabel" title={fullLabel}>
                    <span className="sr-only">
                      {item.excluded && `${t("filterNotTag")} `}
                    </span>
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
                    aria-label={`${t("activeFilterRemoveItemTitle")}: ${fullLabel}`}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              );
            })}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="activeFilterMoreButton"
                data-testid="filter-chip-more"
                onClick={() => toggleGroup(f.key)}
                title={t("activeFilterShowMoreTitle", { count: hiddenCount })}
                aria-label={t("activeFilterShowMoreTitle", {
                  count: hiddenCount,
                })}
              >
                +{hiddenCount}
              </button>
            )}
            {expanded && f.items.length > MAX_VISIBLE_VALUES && (
              <button
                type="button"
                className="activeFilterMoreButton"
                data-testid="filter-chip-less"
                onClick={() => toggleGroup(f.key)}
                title={t("activeFilterShowLessTitle", {
                  count: f.items.length - MAX_VISIBLE_VALUES,
                })}
                aria-label={t("activeFilterShowLessTitle", {
                  count: f.items.length - MAX_VISIBLE_VALUES,
                })}
              >
                &minus;{f.items.length - MAX_VISIBLE_VALUES}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
