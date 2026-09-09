import { useMemo } from 'react'

import { useActivityTask, useActivityTasks } from './ActivityProvider.jsx'
import { useFilters } from '../filters/FilterProvider.jsx'
import { useMapState } from '../map/MapStateProvider.jsx'
import { useSelection } from '../selection/SelectionProvider.jsx'

// The label for each layer id Map.jsx can report as loading. Kept here rather
// than in Map.jsx so nothing in the map has to know about i18n, and phrased as
// a thing being loaded ("Track lines") rather than as the switch that toggles
// it ("Show track lines").
const MAP_LAYER_LABEL_KEYS = {
  observations: 'activityLayerObservations',
  tracks: 'activityLayerTracks',
  bathymetry: 'activityLayerBathymetry',
  imagery: 'activityLayerImagery',
  griddap: 'activityLayerGriddap',
  wmsOverlay: 'activityLayerWmsOverlay'
}

// Registers the provider-level loading flags with ActivityProvider. Renders
// nothing — it exists so the providers themselves stay unaware of the activity
// registry, the same way UrlSync owns the cross-provider URL wiring without
// any provider knowing about the URL.
//
// Work owned by a single component registers itself instead (DownloadDetails'
// size estimates, DatasetInspector's record list), because the flag never
// leaves that component.
export default function ActivityTasks () {
  const { loading, loadingLayers, legendLoading } = useMapState()
  const { selectionLoading, recordLoading } = useSelection()
  const { catalogLoaded } = useFilters()

  const mapLayerKeys = useMemo(
    () => loadingLayers.map((id) => MAP_LAYER_LABEL_KEYS[id]).filter(Boolean),
    [loadingLayers]
  )
  useActivityTasks(mapLayerKeys)

  // Only when the map is redrawing but no layer owns up to a fetch — a style
  // change, or tiles that resolved from cache faster than the announce delay.
  // Naming the layers is strictly better than this when we can.
  useActivityTask('mapUpdatingText', loading && mapLayerKeys.length === 0)

  useActivityTask('legendLoadingText', legendLoading)
  useActivityTask('activityDatasetsText', selectionLoading)
  useActivityTask('activityRecordText', recordLoading)
  useActivityTask('activityCatalogText', !catalogLoaded)

  return null
}
