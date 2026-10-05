import useActiveFilters from "./useActiveFilters.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";

// Everything a filter can set, the quick filters and the modal ones alike,
// back to its default: `[canReset, reset]`, shared by the quick filters' reset
// button and the search palette so the two clear exactly the same state.
export default function useResetAllFilters() {
  const { requestDraw, resetDataLayers } = useMapState();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();
  const { resetFilters, realtimeOnly } = useFilters();
  const activeFilterCount = useActiveFilters().length;

  const canReset =
    Boolean(polygon) ||
    onlyInView ||
    realtimeOnly ||
    Boolean(datasetTitleSearchText) ||
    activeFilterCount > 0;

  function reset() {
    resetFilters();
    resetDataLayers();
    requestDraw("clear");
    setDatasetTitleSearchText("");
    setOnlyInView(false);
  }

  return [canReset, reset];
}
