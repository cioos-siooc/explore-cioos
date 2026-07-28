import * as React from 'react'

import Map from './Map.jsx'
import { useFilters } from '../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../state/selection/SelectionProvider.jsx'

// Single adapter between the state providers and the imperative Map
// component — Map.js keeps its prop-based interface untouched.
export default function MapContainer () {
  const { setDatasetsSelected } = useFilters()
  const {
    mapQueryString,
    setLoading,
    setMapView,
    rangeLevels,
    trajectoryRangeLevels,
    obisRangeLevels,
    griddapCoverageVisible,
    griddapCoverage,
    dataLayersVisible,
    activeWmsOverlay,
    projection,
    basemap,
    zoomTarget,
    mapRef,
    tracksMode,
    debouncedScrubTime,
    trailingDays,
    dataLayers
  } = useMapState()
  const {
    polygon,
    setPolygon,
    setPointsToReview,
    hoveredDataset,
    setHoveredDataset,
    inspectDataset,
    selectedTrajectory,
    selectTrajectoryFromMap
  } = useSelection()

  return (
    <Map
      polygon={polygon}
      setPolygon={setPolygon}
      setPointsToReview={setPointsToReview}
      setLoading={setLoading}
      mapQueryString={mapQueryString}
      setMapView={setMapView}
      rangeLevels={rangeLevels}
      trajectoryRangeLevels={trajectoryRangeLevels}
      obisRangeLevels={obisRangeLevels}
      offsetFlyTo={false}
      setHoveredDataset={setHoveredDataset}
      hoveredDataset={hoveredDataset}
      inspectDataset={inspectDataset}
      setDatasetsSelected={setDatasetsSelected}
      tracksMode={tracksMode}
      scrubTime={debouncedScrubTime}
      trailingDays={trailingDays}
      selectedTrajectory={selectedTrajectory}
      selectTrajectoryFromMap={selectTrajectoryFromMap}
      dataLayers={dataLayers}
      griddapCoverage={griddapCoverageVisible ? griddapCoverage : null}
      dataLayersVisible={dataLayersVisible}
      activeWmsOverlay={activeWmsOverlay}
      projection={projection}
      basemap={basemap}
      zoomTarget={zoomTarget}
      mapRef={mapRef}
    />
  )
}
