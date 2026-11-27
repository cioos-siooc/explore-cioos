import { useActivityTask } from "./ActivityProvider.jsx";
import { useFilters } from "../filters/FilterProvider.jsx";
import { useMapState, useMapView } from "../map/MapStateProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";

// Keeps the providers unaware of the activity registry, as UrlSync does for
// the URL. Component-owned work registers itself.
export default function ActivityTasks() {
  const { legendLoading } = useMapState();
  const { loading, dataLoading } = useMapView();
  const { selectionLoading, recordLoading } = useSelection();
  const { catalogLoaded } = useFilters();

  useActivityTask("mapUpdatingText", loading || dataLoading);

  useActivityTask("legendLoadingText", legendLoading);
  useActivityTask("activityDatasetsText", selectionLoading);
  useActivityTask("activityRecordText", recordLoading);
  useActivityTask("activityCatalogText", !catalogLoaded);

  return null;
}
