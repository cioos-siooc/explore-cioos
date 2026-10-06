import { useMapState } from "../map/MapStateProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";
import { useUI } from "../ui/UIProvider.jsx";
import {
  findTrajectory,
  showGridded,
  showTrajectory,
  showWhatsHere,
} from "./scenes.js";

// What each step of the tips tour sets up so the control its tip talks about
// is on screen to be highlighted. Only state held above the control lives
// here; a surface that owns its own visibility (the legend card, the time bar)
// opens itself for its tip instead. A tip with nothing to set up — or whose
// control needs something the catalogue doesn't have — has no stage.
export default function useTourStages() {
  const {
    pointsData,
    inspectDataset,
    setInspectDataset,
    selectTrajectoryFromMap,
  } = useSelection();
  const { zoomToGeometry, requestFeatureQueryAt } = useMapState();
  const { setSidebarOpen, setQuickFiltersCollapsed } = useUI();

  // Keeps an already-open page that fits rather than swapping it for another.
  const openDataset = (fits) => {
    setSidebarOpen(true);
    if (inspectDataset && fits(inspectDataset)) return;
    const dataset = pointsData.find(fits);
    if (dataset) setInspectDataset(dataset);
  };
  const showQuickFilters = () => setQuickFiltersCollapsed(false);

  return {
    whatsHere: () => {
      // The card waits out an open sidebar (see FeatureCard).
      setSidebarOpen(false);
      showWhatsHere({ zoomToGeometry, requestFeatureQueryAt });
    },
    inView: showQuickFilters,
    realtime: showQuickFilters,
    // A page with a feature list: OBIS and gridded pages have none.
    showData: () =>
      openDataset(
        (dataset) =>
          dataset.source_type !== "obis" && dataset.cdm_data_type !== "Grid",
      ),
    trajectory: () => {
      const dataset = findTrajectory(pointsData);
      if (!dataset) return;
      setSidebarOpen(true);
      showTrajectory(dataset, {
        selectTrajectoryFromMap,
        setInspectDataset,
        zoomToGeometry,
      });
    },
    griddapWms: () => {
      const dataset = pointsData.find((row) => row.wms_url);
      if (!dataset) return;
      setSidebarOpen(true);
      showGridded(dataset, { setInspectDataset, zoomToGeometry });
    },
    filtersCutDownload: () => setSidebarOpen(true),
    directLinks: () => setSidebarOpen(true),
  };
}
