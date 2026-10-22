import { useMemo } from "react";

import { useActivityTask, useActivityTasks } from "./ActivityProvider.jsx";
import { useFilters } from "../filters/FilterProvider.jsx";
import { useMapState, useMapView } from "../map/MapStateProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";

// Here so the map needn't know about i18n; phrased as the thing loaded, not
// the switch.
const MAP_LAYER_LABEL_KEYS = {
  observations: "activityLayerObservations",
  tracks: "activityLayerTracks",
  bathymetry: "activityLayerBathymetry",
  imagery: "activityLayerImagery",
  griddap: "activityLayerGriddap",
  wmsOverlay: "activityLayerWmsOverlay",
};

// Keeps the providers unaware of the activity registry, as UrlSync does for
// the URL. Component-owned work registers itself.
export default function ActivityTasks() {
  const { legendLoading } = useMapState();
  const { loading, loadingLayers } = useMapView();
  const { selectionLoading, recordLoading } = useSelection();
  const { catalogLoaded } = useFilters();

  const mapLayerKeys = useMemo(
    () => loadingLayers.map((id) => MAP_LAYER_LABEL_KEYS[id]).filter(Boolean),
    [loadingLayers],
  );
  useActivityTasks(mapLayerKeys);

  // Fallback for a redraw no layer owns up to (style change, fast cache hits).
  useActivityTask("mapUpdatingText", loading && mapLayerKeys.length === 0);

  useActivityTask("legendLoadingText", legendLoading);
  useActivityTask("activityDatasetsText", selectionLoading);
  useActivityTask("activityRecordText", recordLoading);
  useActivityTask("activityCatalogText", !catalogLoaded);

  return null;
}
