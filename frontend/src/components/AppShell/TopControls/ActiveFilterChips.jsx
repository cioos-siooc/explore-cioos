import * as React from "react";
import { useEffect, useState } from "react";
import { X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import useActiveFilters, {
  QUICK_FILTER_KEYS,
} from "../../../state/useActiveFilters.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";

// Short enough that a group's values stay on its label pill's row.
const MAX_VISIBLE_VALUES = 2;

// Clear all is the quick filters' Reset (see QuickFilters).
export default function ActiveFilterChips() {
  const { t } = useTranslation();
  const allFilters = useActiveFilters();
  const activeFilters = allFilters.filter((f) => !QUICK_FILTER_KEYS.has(f.key));
  const { eovsMatchAll } = useFilters();
  const { offerTip } = useTips();
  const filtering = allFilters.length > 0;
  // Each refines a filter just set, so it is offered ahead of the general one.
  const listFiltering = activeFilters.length > 0;
  const items = activeFilters.flatMap((f) => f.items ?? []);
  const excluding = items.some((item) => item.excluded);
  const eovsIncluded = (
    activeFilters.find((f) => f.key === "eovs")?.items ?? []
  ).filter((item) => !item.excluded).length;
  const offerMatchAll = eovsIncluded > 1 && !eovsMatchAll;
  useEffect(() => {
    if (!filtering) return;
    offerTip([
      ...(offerMatchAll ? ["matchAll"] : []),
      ...(listFiltering && !excluding ? ["exclude"] : []),
      "shareLink",
    ]);
  }, [filtering, offerMatchAll, listFiltering, excluding, offerTip]);

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
              // The chip shows the "not" as its own tag instead.
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
                    // Unique per chip so tests and screen readers can tell them apart.
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
