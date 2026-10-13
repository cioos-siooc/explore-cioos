import useActiveFilters from "./useActiveFilters.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";

// Everything a filter can set back to its default: `[canReset, reset]`, shared
// by every reset button so they all clear exactly the same state.
export default function useResetAllFilters() {
  const { requestDraw, resetDataLayers } = useMapState();
  const { setDatasetTitleSearchText, setOnlyInView } = useSelection();
  const { resetFilters } = useFilters();
  const canReset = useActiveFilters().length > 0;

  function reset() {
    resetFilters();
    resetDataLayers();
    requestDraw("clear");
    setDatasetTitleSearchText("");
    setOnlyInView(false);
  }

  return [canReset, reset];
}
