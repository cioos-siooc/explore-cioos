import { useTranslation } from "react-i18next";

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
import { useSelection } from "./selection/SelectionProvider.jsx";
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
    case "polygon":
      return "spatialFilterFilterName";
    default:
      return undefined;
  }
}

// Every filter currently constraining the map, as one list of groups:
// `{ key, label, goToFilter, removeAll, items }`, one item per chosen value.
//
// Four of them are not the catalogue facets FilterProvider owns — the geometry
// layers live in MapState, the title search, the "only in view" narrowing and
// the drawn area in Selection — so the list can only be assembled above all
// three providers. That is the whole reason this is a hook and not another
// field on FilterProvider: counting only the facets it could see was what made
// the Filters badge report fewer filters than the chips directly under it
// listed.
//
// The chips render this list and the Filters button and modal count it, so the
// number and the list it labels cannot disagree.
export default function useActiveFilters() {
  const { t } = useTranslation();
  const { buildActiveFilters, startDate, endDate, startDepth, endDepth } =
    useFilters();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();
  const { dataLayers, toggleDataLayer, resetDataLayers, requestDraw } =
    useMapState();
  const { setShowFiltersModal, setOpenFilter, setSidebarOpen } = useUI();

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
    // The drawn shape narrows the map exactly as the facets above do, so it is
    // a group like any other rather than a chip on its own terms — which is
    // also what lets the badge count it.
    Boolean(polygon) && {
      key: "polygon",
      label: t("spatialFilterFilterName"),
      removeAll: () => requestDraw("clear"),
      items: [
        {
          id: "polygon",
          label: t("chipMapSelectionLabel"),
          remove: () => requestDraw("clear"),
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
}
