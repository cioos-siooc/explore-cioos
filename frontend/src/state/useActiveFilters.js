import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowsExpand,
  BroadcastPin,
  Building,
  CalendarWeek,
  FileEarmarkSpreadsheet,
  Server,
  Stack,
  Tag,
  Water,
} from "react-bootstrap-icons";

import { generateRangeSelectBadgeTitle } from "../utilities.jsx";
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
} from "../components/config.js";
import { DATA_LAYER_LABEL_KEYS, selectedDataLayerKeys } from "./dataLayers.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";
import { useUI } from "./ui/UIProvider.jsx";

// Maps each group key to the filterName FiltersPanel opens it under (see
// FiltersPanel.jsx — most groups key off a stable i18n key, but time/depth key
// off their own translated label, so those two are computed with t() rather
// than hardcoded).
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

// The same icon FiltersPanel shows on that filter's own row (see
// FiltersPanel.jsx's `icon` prop per <Filter>), so a chip and the row it came
// from read as the same filter at a glance.
const ICON_FOR_KEY = {
  eovs: Water,
  platforms: BroadcastPin,
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
function iconForKey(key) {
  const Icon = ICON_FOR_KEY[key];
  return Icon
    ? React.createElement(Icon, { size: 12, "aria-hidden": true })
    : null;
}

// Every filter the Filters modal counts, as one list of groups:
// `{ key, label, goToFilter, removeAll, items }`, one item per chosen value.
//
// One of them is not a catalogue facet FilterProvider owns — the geometry
// layers live in MapState — so the list can only be assembled above both
// providers. That is the whole reason this is a hook and not another field on
// FilterProvider: counting only the facets it could see was what made the
// Filters badge report fewer filters than the chips directly under it
// listed.
//
// The chips render this list and the Filters button and modal count it, so the
// number and the list it labels cannot disagree.
//
// The quick filters — the title search, the drawn area and the "only in view"
// narrowing — are deliberately not here, even though FiltersPanel also has a
// row for each of them: they have their own buttons on the map (see
// QuickFilters), so a chip and a badge tick for something that already has a
// lit button next to it would be the same state announced twice. Both write
// the same underlying state (Selection), so the modal row and the map button
// always agree with each other.
export default function useActiveFilters() {
  const { t } = useTranslation();
  const {
    buildActiveFilters,
    startDate,
    endDate,
    startDepth,
    endDepth,
    realtimeOnly,
    setRealtimeOnly,
  } = useFilters();
  const { dataLayers, toggleDataLayer, resetDataLayers } = useMapState();
  const { setShowFiltersModal, setOpenFilter } = useUI();

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

  return [
    chosenDataLayers.length > 0 && {
      key: "dataLayers",
      label: t("layerSelectorLabel"),
      removeAll: resetDataLayers,
      items: chosenDataLayers.map((key) => ({
        id: key,
        label: t(DATA_LAYER_LABEL_KEYS[key]),
        remove: () => toggleDataLayer(key),
      })),
    },
    ...buildActiveFilters({ timeframesBadgeTitle, depthRangeBadgeTitle }),
    realtimeOnly && {
      key: "realtimeOnly",
      label: t("realtimeFilterName"),
      goToFilter: () => {
        setOpenFilter(t("realtimeFilterName"));
        setShowFiltersModal(true);
      },
      removeAll: () => setRealtimeOnly(false),
      items: [
        {
          id: "realtimeOnly",
          label: t("realtimeFilterChipText"),
          remove: () => setRealtimeOnly(false),
        },
      ],
    },
  ]
    .filter(Boolean)
    .map((f) => ({
      ...f,
      icon: iconForKey(f.key),
      goToFilter:
        f.goToFilter ||
        (() => {
          setOpenFilter(filterNameForKey(f.key, t));
          setShowFiltersModal(true);
        }),
    }));
}
