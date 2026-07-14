import * as React from 'react'
import { createContext, useContext, useRef, useState, useEffect } from 'react'
import isEmpty from 'lodash/isEmpty'

import { server } from '../../config.js'
import { basemap as defaultBasemap } from '../../components/config.js'
import {
  createDataFilterQueryString,
  getCurrentRangeLevel
} from '../../utilities.jsx'
import fetchJson from '../fetchJson.js'
import { useFilters } from '../filters/FilterProvider.jsx'

const MapStateContext = createContext()

export function useMapState () {
  return useContext(MapStateContext)
}

export default function MapStateProvider ({ children }) {
  const { query } = useFilters()

  const [loading, setLoading] = useState(true)
  const [mapView, setMapView] = useState({})
  const [rangeLevels, setRangeLevels] = useState()
  const [currentRangeLevel, setCurrentRangeLevel] = useState()
  const [trajectoryRangeLevels, setTrajectoryRangeLevels] = useState()
  const [currentTrajectoryRangeLevel, setCurrentTrajectoryRangeLevel] =
    useState()
  // Griddap (gridded, metadata-only) datasets: the optional coverage layer
  // (off by default) and the on-demand per-dataset WMS overlay
  // ({pk, datasetId, wmsUrl, variable, time, elevation, bbox} | undefined).
  const [griddapCoverageVisible, setGriddapCoverageVisible] = useState(false)
  const [griddapCoverage, setGriddapCoverage] = useState()
  const [activeWmsOverlay, setActiveWmsOverlay] = useState()
  // Layer visibility switch for the observation layers (hexes / points /
  // trajectories). On by default.
  const [dataLayersVisible, setDataLayersVisible] = useState(true)
  // Map projection: 'mercator' (default) or 'globe'. The globe view renders
  // high latitudes (e.g. the Arctic) without Mercator distortion.
  const [projection, setProjection] = useState('mercator')
  // Basemap raster: 'emodnet' (default) or 'arcgis-ocean'.
  // See components/Map/basemapStyle.js.
  const [basemap, setBasemap] = useState(defaultBasemap)
  // One-shot "frame this geometry" request for the Map. The nonce lets the
  // same extent be re-requested (clicking zoom again after panning away).
  const [zoomTarget, setZoomTarget] = useState()
  // A share link can carry ?dataset=… with no lat/lon/zoom (the user only
  // meant to point at the dataset, not a specific camera). SelectionProvider
  // consumes this once the dataset resolves, framing its footprint instead of
  // falling back to the default world view.
  const [pendingDatasetZoom, setPendingDatasetZoom] = useState(() => {
    const params = new URL(window.location.href).searchParams
    return Boolean(params.get('dataset')) &&
      !(params.get('lat') || params.get('lon') || params.get('zoom'))
  })
  // The MapLibre instance, handed over by Map.jsx once created. ZoomToDataset
  // needs it to ask what camera a footprint would produce (cameraForBounds
  // depends on the canvas size, which only the map knows).
  const mapRef = useRef(null)

  function zoomToGeometry (geometry) {
    if (geometry) setZoomTarget({ geometry, nonce: Date.now() })
  }

  const { zoom } = mapView

  // A failed legend fetch (e.g. gateway timeout) just leaves the current
  // color ramp in place — the map itself keeps working — so failures log
  // instead of crashing, and loadLegend() is exposed for the retry banner.
  function loadLegend (legendQuery) {
    fetchJson(`${server}/legend${legendQuery ? '?' + legendQuery : ''}`)
      .then((legend) => {
        if (legend) {
          setRangeLevels(legend.recordsCount)
          setTrajectoryRangeLevels(legend.trajectoryRecordsCount)
        }
      })
      .catch((error) => {
        console.error('legend fetch failed:', error)
      })
  }

  // Initial map view from a share link, and the initial legend values.
  useEffect(() => {
    const { lat, lon, zoom } = Object.fromEntries(
      new URL(window.location.href).searchParams
    )
    if (lat || lon || zoom) setMapView({ lat, lon, zoom })

    loadLegend(createDataFilterQueryString(query))
  }, [])

  // Refetch the legend whenever the (debounced) query changes.
  useEffect(() => {
    if (!loading && !isEmpty(rangeLevels)) {
      loadLegend(createDataFilterQueryString(query))
    }
  }, [query])

  // Fetch griddap coverage bboxes when the layer is visible, in lockstep
  // with the same debounced query the tiles and /pointQuery use. Data is
  // kept when the layer is toggled off so re-showing it is instant.
  useEffect(() => {
    if (!griddapCoverageVisible) return
    const controller = new AbortController()
    fetch(`${server}/griddapCoverage?${createDataFilterQueryString(query)}`, {
      signal: controller.signal
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((coverage) => {
        if (coverage) setGriddapCoverage(coverage)
      })
      .catch((error) => {
        if (error.name !== 'AbortError') throw error
      })
    return () => controller.abort()
  }, [query, griddapCoverageVisible])

  useEffect(() => {
    if (rangeLevels) {
      setCurrentRangeLevel(getCurrentRangeLevel(rangeLevels, zoom))
    }
  }, [rangeLevels, zoom])

  useEffect(() => {
    // Trajectory hexes only render at zoom >= 7 (below that, trajectory
    // counts are merged into the green hex ramp) — hide the legend entry
    // otherwise.
    if (trajectoryRangeLevels && zoom >= 7) {
      setCurrentTrajectoryRangeLevel(trajectoryRangeLevels.zoom1)
    } else {
      setCurrentTrajectoryRangeLevel()
    }
  }, [trajectoryRangeLevels, zoom])

  const value = {
    loading,
    setLoading,
    mapView,
    setMapView,
    zoom,
    rangeLevels,
    trajectoryRangeLevels,
    currentRangeLevel,
    currentTrajectoryRangeLevel,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    projection,
    setProjection,
    basemap,
    setBasemap,
    griddapCoverage,
    activeWmsOverlay,
    setActiveWmsOverlay,
    zoomTarget,
    zoomToGeometry,
    pendingDatasetZoom,
    setPendingDatasetZoom,
    mapRef,
    loadLegend: () => loadLegend(createDataFilterQueryString(query))
  }

  return (
    <MapStateContext.Provider value={value}>
      {children}
    </MapStateContext.Provider>
  )
}
