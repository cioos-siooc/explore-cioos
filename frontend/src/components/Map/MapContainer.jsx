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
    setBasemapLoading,
    setMapView,
    rangeLevels,
    coverageRangeLevels,
    setViewportHexRange,
    griddapCoverageVisible,
    griddapCoverage,
    dataLayersVisible,
    bathymetryVisible,
    activeWmsOverlay,
    projection,
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
      setBasemapLoading={setBasemapLoading}
      mapQueryString={mapQueryString}
      setMapView={setMapView}
      rangeLevels={rangeLevels}
      coverageRangeLevels={coverageRangeLevels}
      onViewportHexRange={setViewportHexRange}
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
      bathymetryVisible={bathymetryVisible}
      activeWmsOverlay={activeWmsOverlay}
      projection={projection}
      zoomTarget={zoomTarget}
      mapRef={mapRef}
    />
  )
}
