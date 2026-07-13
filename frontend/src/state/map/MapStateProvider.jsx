import * as React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'
import isEmpty from 'lodash/isEmpty'

import { server } from '../../config.js'
import { defaultTrailingDays } from '../../components/config.js'
import {
  createDataFilterQueryString,
  getCurrentRangeLevel,
  useDebounce
} from '../../utilities.jsx'
import fetchJson from '../fetchJson.js'
import { useFilters } from '../filters/FilterProvider.jsx'

const ALL_DATA_LAYERS = {
  profile: true,
  timeseries: true,
  timeseriesProfile: true,
  obis: true,
  trajectories: true,
  hexCells: true
}

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
  // Layer-picker visibility switches: the observation layers (hexes/points/
  // trajectories) and the floating legend card. Both on by default.
  const [dataLayersVisible, setDataLayersVisible] = useState(true)
  const [legendVisible, setLegendVisible] = useState(true)
  // Map projection: 'mercator' (default) or 'globe'. The globe view renders
  // high latitudes (e.g. the Arctic) without Mercator distortion.
  const [projection, setProjection] = useState('mercator')

  // Tracks mode (trajectory track lines + time scrub bar) and the data-type
  // layer selection, both restored from share-link params (UrlSync writes
  // them back).
  const urlParams = new URL(window.location.href).searchParams
  const [tracksMode, setTracksMode] = useState(
    urlParams.get('tracks') === 'true'
  )
  const [scrubTime, setScrubTime] = useState(
    urlParams.get('scrubTime') || new Date().toISOString().split('T')[0]
  )
  const debouncedScrubTime = useDebounce(scrubTime, 250)
  const [trailingDays, setTrailingDays] = useState(
    Number.parseInt(urlParams.get('trail')) || defaultTrailingDays
  )
  const [smoothTracks, setSmoothTracks] = useState(false)

  // Data-type layers shown on the map. Absent `layers` param = all on; a
  // present param is the comma list of enabled layers (so a non-default
  // selection round-trips through the URL).
  const [dataLayers, setDataLayers] = useState(() => {
    const layersParam = urlParams.get('layers')
    if (layersParam == null) return ALL_DATA_LAYERS
    const on = new Set(layersParam.split(',').filter(Boolean))
    return Object.fromEntries(
      Object.keys(ALL_DATA_LAYERS).map((key) => [key, on.has(key)])
    )
  })

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
    legendVisible,
    setLegendVisible,
    projection,
    setProjection,
    tracksMode,
    setTracksMode,
    scrubTime,
    setScrubTime,
    debouncedScrubTime,
    trailingDays,
    setTrailingDays,
    smoothTracks,
    setSmoothTracks,
    dataLayers,
    setDataLayers,
    griddapCoverage,
    activeWmsOverlay,
    setActiveWmsOverlay,
    loadLegend: () => loadLegend(createDataFilterQueryString(query))
  }

  return (
    <MapStateContext.Provider value={value}>
      {children}
    </MapStateContext.Provider>
  )
}
