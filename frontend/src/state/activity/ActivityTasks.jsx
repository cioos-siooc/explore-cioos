import { useActivityTask } from './ActivityProvider.jsx'
import { useFilters } from '../filters/FilterProvider.jsx'
import { useMapState } from '../map/MapStateProvider.jsx'
import { useSelection } from '../selection/SelectionProvider.jsx'

// Registers the provider-level loading flags with ActivityProvider. Renders
// nothing — it exists so the providers themselves stay unaware of the activity
// registry, the same way UrlSync owns the cross-provider URL wiring without
// any provider knowing about the URL.
//
// Work owned by a single component registers itself instead (DownloadDetails'
// size estimates, DatasetInspector's record list), because the flag never
// leaves that component.
export default function ActivityTasks () {
  const { loading, basemapLoading, legendLoading } = useMapState()
  const { selectionLoading, recordLoading } = useSelection()
  const { catalogLoaded } = useFilters()

  useActivityTask('mapUpdatingText', loading)
  useActivityTask('mapTilesLoadingText', basemapLoading)
  useActivityTask('legendLoadingText', legendLoading)
  useActivityTask('activityDatasetsText', selectionLoading)
  useActivityTask('activityRecordText', recordLoading)
  useActivityTask('activityCatalogText', !catalogLoaded)

  return null
}
