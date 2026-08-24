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
    drawRequest,
    mapRef,
    featureQuery,
    setFeatureQuery,
    tracksMode,
    debouncedScrubTime,
    trailingDays,
    dataLayers
  } = useMapState()
  const {
    polygon,
    setPolygon,
    hoveredDataset,
    setHoveredDataset,
    inspectDataset,
    selectedTrajectory
  } = useSelection()

  return (
    <Map
      polygon={polygon}
      setPolygon={setPolygon}
      setLoading={setLoading}
      setBasemapLoading={setBasemapLoading}
      mapQueryString={mapQueryString}
      setMapView={setMapView}
      rangeLevels={rangeLevels}
      coverageRangeLevels={coverageRangeLevels}
      onViewportHexRange={setViewportHexRange}
      onFeatureQuery={setFeatureQuery}
      featureQuery={featureQuery}
      setHoveredDataset={setHoveredDataset}
      hoveredDataset={hoveredDataset}
      inspectDataset={inspectDataset}
      setDatasetsSelected={setDatasetsSelected}
      tracksMode={tracksMode}
      scrubTime={debouncedScrubTime}
      trailingDays={trailingDays}
      selectedTrajectory={selectedTrajectory}
      dataLayers={dataLayers}
      griddapCoverage={griddapCoverageVisible ? griddapCoverage : null}
      dataLayersVisible={dataLayersVisible}
      bathymetryVisible={bathymetryVisible}
      activeWmsOverlay={activeWmsOverlay}
      projection={projection}
      zoomTarget={zoomTarget}
      drawRequest={drawRequest}
      mapRef={mapRef}
    />
  )
}
