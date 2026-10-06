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

import useFilterModel from "./useFilterModel.js";
import { useSelection } from "./selection/SelectionProvider.jsx";
import { useUI } from "./ui/UIProvider.jsx";

// The same icon FiltersPanel shows on that filter's own row (see
// FiltersPanel.jsx's `icon` prop per <Filter>), so a chip and the row it came
// from read as the same filter at a glance.
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

// createElement, not JSX: this is a plain .js module (no esbuild JSX loader
// configured for that extension — see vite.config.mjs), and renaming it to
// .jsx isn't worth doing for the one element this hook returns.
export function iconForKey(key) {
  const Icon = ICON_FOR_KEY[key];
  return Icon
    ? React.createElement(Icon, { size: 14, "aria-hidden": true })
    : null;
}

// The quick filters' own buttons light up while they are set (see
// QuickFilters), so the chips leave them out.
export const QUICK_FILTER_KEYS = new Set(["area", "inView", "realtime"]);

// Every filter currently narrowing the map, quick filters included, as one
// list of groups: `{ key, label, icon, goToFilter, removeAll, items }`, one
// item per applied value. Read off useFilterModel, the same description the
// search palette lists, so the chips, the Filters badge that counts them and
// the palette's own applied list cannot disagree.
export default function useActiveFilters() {
  const model = useFilterModel();
  const { datasetTitleSearchText } = useSelection();
  const { setShowFiltersModal, setOpenFilter, openFilterSearch } = useUI();

  return model.flatMap((group) => {
    const applied = group.options.filter((o) => o.state);
    if (applied.length === 0) return [];
    return {
      key: group.key,
      label: group.label,
      icon: iconForKey(group.key),
      removeAll: group.clear,
      // The title search has no row of its own in the Filters modal: it is
      // the palette's (see FilterSearch).
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
