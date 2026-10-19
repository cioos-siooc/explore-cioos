import { useFilters } from "../filters/FilterProvider.jsx";
import { useMapState } from "../map/MapStateProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";
import { useUI } from "../ui/UIProvider.jsx";
import {
  findTrajectory,
  showGridded,
  showTrajectory,
  showWhatsHere,
} from "./scenes.js";

// A step that opens a dialog returns which one (TIP_MODALS) so the tour can
// close it. Only state held above the control lives here; surfaces owning
// their own visibility open themselves. `skipped` names tips whose control
// needs data the catalogue lacks.
export default function useTourStages() {
  const { obisDataAvailable } = useFilters();
  const {
    pointsData,
    pointsToReview,
    inspectDataset,
    setInspectDataset,
    selectTrajectoryFromMap,
  } = useSelection();
  const { zoomToGeometry, requestFeatureQueryAt } = useMapState();
  const {
    setSidebarOpen,
    setQuickFiltersCollapsed,
    setOpenFilter,
    setShowFiltersModal,
    setShowDownloadModal,
  } = useUI();

  // Keeps an already-open page that fits rather than swapping it for another.
  const openDataset = (fits) => {
    setSidebarOpen(true);
    if (inspectDataset && fits(inspectDataset)) return;
    const dataset = pointsData.find(fits);
    if (dataset) setInspectDataset(dataset);
  };
  const hasFeatureList = (dataset) =>
    dataset.source_type !== "obis" && dataset.cdm_data_type !== "Grid";
  const findGridded = () => pointsData.find((row) => row.wms_url);
  const showQuickFilters = () => setQuickFiltersCollapsed(false);
  const openFilter = (filterName) => () => {
    setOpenFilter(filterName);
    setShowFiltersModal(true);
    return "filters";
  };
  // The dialog lists its sections only once something is selected.
  const openDownload = () => {
    if (pointsToReview?.length) {
      setShowDownloadModal(true);
      return "download";
    }
    setSidebarOpen(true);
    return undefined;
  };

  const skipped = new Set(
    [
      !obisDataAvailable && "speciesName",
      !(inspectDataset && hasFeatureList(inspectDataset)) &&
        !pointsData.some(hasFeatureList) &&
        "showData",
      !findGridded() && "griddapWms",
    ].filter(Boolean),
  );

  const stages = {
    whatsHere: () => {
      // The card waits out an open sidebar (see FeatureCard).
      setSidebarOpen(false);
      showWhatsHere({ zoomToGeometry, requestFeatureQueryAt });
    },
    inView: showQuickFilters,
    speciesName: openFilter("scientificNameFilterName"),
    exclude: openFilter("platformsFilterName"),
    matchAll: openFilter("oceanVariablesFiltername"),
    realtime: showQuickFilters,
    showData: () => openDataset(hasFeatureList),
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
      const dataset = findGridded();
      if (!dataset) return;
      setSidebarOpen(true);
      showGridded(dataset, { setInspectDataset, zoomToGeometry });
    },
    filtersCutDownload: openDownload,
    directLinks: openDownload,
  };
  return { stages, skipped };
}
