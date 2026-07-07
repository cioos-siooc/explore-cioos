import * as React from 'react'

import Map from './Map.js'
import { useFilters } from '../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../state/selection/SelectionProvider.jsx'

// Single adapter between the state providers and the imperative Map
// component — Map.js keeps its prop-based interface untouched.
export default function MapContainer () {
  const { query, setDatasetsSelected } = useFilters()
  const {
    setLoading,
    setMapView,
    rangeLevels,
    trajectoryRangeLevels,
    griddapCoverageVisible,
    griddapCoverage,
    activeWmsOverlay
  } = useMapState()
  const {
    polygon,
    setPolygon,
    setPointsToReview,
    hoveredDataset,
    setHoveredDataset
  } = useSelection()

  return (
    <Map
      polygon={polygon}
      setPolygon={setPolygon}
      setPointsToReview={setPointsToReview}
      setLoading={setLoading}
      query={query}
      setMapView={setMapView}
      rangeLevels={rangeLevels}
      trajectoryRangeLevels={trajectoryRangeLevels}
      offsetFlyTo={false}
      setHoveredDataset={setHoveredDataset}
      hoveredDataset={hoveredDataset}
      setDatasetsSelected={setDatasetsSelected}
      griddapCoverage={griddapCoverageVisible ? griddapCoverage : null}
      activeWmsOverlay={activeWmsOverlay}
    />
  )
}
