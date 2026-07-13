import * as React from 'react'

import Map from './Map.jsx'
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
    dataLayersVisible,
    activeWmsOverlay,
    projection,
    tracksMode,
    debouncedScrubTime,
    trailingDays,
    smoothTracks,
    dataLayers
  } = useMapState()
  const {
    polygon,
    setPolygon,
    setPointsToReview,
    hoveredDataset,
    setHoveredDataset,
    selectedTrajectory
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
      tracksMode={tracksMode}
      scrubTime={debouncedScrubTime}
      trailingDays={trailingDays}
      smoothTracks={smoothTracks}
      selectedTrajectory={selectedTrajectory}
      dataLayers={dataLayers}
      griddapCoverage={griddapCoverageVisible ? griddapCoverage : null}
      dataLayersVisible={dataLayersVisible}
      activeWmsOverlay={activeWmsOverlay}
      projection={projection}
    />
  )
}
