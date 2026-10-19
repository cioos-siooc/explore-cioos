import * as React from "react";
import {
  ArrowsExpand,
  BoundingBox,
  BroadcastPin,
  Building,
  Cursor,
  CalendarWeek,
  Eye,
  FileEarmarkSpreadsheet,
  Search,
  Server,
  Stack,
  Tag,
  Water,
} from "react-bootstrap-icons";

import { appliedOptions } from "./filterSearch.js";
import useFilterModel from "./useFilterModel.js";
import { useSelection } from "./selection/SelectionProvider.jsx";
import { useUI } from "./ui/UIProvider.jsx";

// Same icon as the filter's FiltersPanel row.
const ICON_FOR_KEY = {
  text: Search,
  realtime: BroadcastPin,
  inView: Eye,
  area: BoundingBox,
  eovs: Water,
  platforms: Cursor,
  orgs: Building,
  datasets: FileEarmarkSpreadsheet,
  sources: Server,
  time: CalendarWeek,
  depth: ArrowsExpand,
  scientificName: Tag,
  dataLayers: Stack,
};

// createElement, not JSX: no JSX loader for .js (see vite.config.mjs).
export function iconForKey(key) {
  const Icon = ICON_FOR_KEY[key];
  return Icon
    ? React.createElement(Icon, { size: 14, "aria-hidden": true })
    : null;
}

export const QUICK_FILTER_KEYS = new Set(["area", "inView", "realtime"]);

// `{ key, label, icon, goToFilter, removeAll, items }` per group, read off
// useFilterModel so chips, the Filters badge and the palette cannot disagree.
export default function useActiveFilters() {
  const model = useFilterModel();
  const { datasetTitleSearchText } = useSelection();
  const { setShowFiltersModal, setOpenFilter, openFilterSearch } = useUI();

  return model.flatMap((group) => {
    const applied = appliedOptions(group);
    if (applied.length === 0) return [];
    return {
      key: group.key,
      label: group.label,
      icon: iconForKey(group.key),
      removeAll: group.clear,
      // The title search has no Filters modal row: it is the palette's.
      goToFilter: group.panelName
        ? () => {
            setOpenFilter(group.panelName);
            setShowFiltersModal(true);
          }
        : () => openFilterSearch(datasetTitleSearchText),
      items: applied.map((option) => ({
        id: option.id,
        label: option.label,
        excluded: option.state === "exclude",
        remove: () => option.toggle(option.state),
      })),
    };
  });
}
