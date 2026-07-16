import * as React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useEffect
} from 'react'
import isEmpty from 'lodash/isEmpty'

import { server } from '../../config.js'
import {
  basemap as defaultBasemap,
  defaultTrailingDays
} from '../../components/config.js'
import {
  applyMapDatasetPKs,
  createDataFilterQueryString,
  getCurrentRangeLevel,
  useDebounce
} from '../../utilities.jsx'
import fetchJson from '../fetchJson.js'
import usePersistentState from '../usePersistentState.js'
import { useFilters } from '../filters/FilterProvider.jsx'

const ALL_DATA_LAYERS = {
  profile: true,
  timeseries: true,
  timeseriesProfile: true,
  obis: true,
  trajectories: true
}

const MapStateContext = createContext()

export function useMapState () {
  return useContext(MapStateContext)
}

export default function MapStateProvider ({ children }) {
  const { query } = useFilters()

  // The map is "loading" whenever it's redrawing (initial style + tiles, a
  // filter change, a new selection polygon); Map.jsx flips it back on 'idle'.
  // mapLoaded records that it has settled at least once — the first load is a
  // blank screen and earns the full splash, every later redraw happens over a
  // usable map and only earns the quiet MapBusy pill.
  const [loading, setLoadingState] = useState(true)
  const [mapLoaded, setMapLoaded] = useState(false)
  const setLoading = useCallback((value) => {
    setLoadingState(value)
    if (!value) setMapLoaded(true)
  }, [])
  const [mapView, setMapView] = useState({})
  // The datasets the map is allowed to draw, when the user has hidden some
  // groups in the datasets list (see SelectionProvider, which owns the
  // grouping and pushes the resulting pk list here — it lives downstream of
  // this provider, so it can't be read from it). undefined means "no group
  // hidden": every dataset the filters allow is drawn.
  //
  // It lands here rather than in the filter query because it is deliberately
  // map-only: the sidebar list, its counts and the download selection all keep
  // the hidden datasets.
  const [mapDatasetPKs, setMapDatasetPKs] = useState()
  // Every map query (tiles, legend, coverage) is the filter query narrowed to
  // the shown groups.
  const mapQueryString = applyMapDatasetPKs(
    createDataFilterQueryString(query),
    mapDatasetPKs
  )
  const [rangeLevels, setRangeLevels] = useState()
  const [legendLoading, setLegendLoading] = useState(true)
  const [currentRangeLevel, setCurrentRangeLevel] = useState()
  const [trajectoryRangeLevels, setTrajectoryRangeLevels] = useState()
  const [currentTrajectoryRangeLevel, setCurrentTrajectoryRangeLevel] =
    useState()
  const [obisRangeLevels, setObisRangeLevels] = useState()
  const [currentObisRangeLevel, setCurrentObisRangeLevel] = useState()
  // The four map-appearance switches below are preferences rather than
  // shareable state: they persist in localStorage so a reload comes back to
  // the map the user left, while the camera and filters keep living in the URL.
  //
  // Griddap (gridded, metadata-only) datasets: the optional coverage layer
  // (off by default) and the on-demand per-dataset WMS overlay
  // ({pk, datasetId, wmsUrl, variable, time, elevation, bbox} | undefined).
  // The overlay itself is per-dataset and dies with the dataset page, so it
  // is deliberately not persisted.
  const [griddapCoverageVisible, setGriddapCoverageVisible] = usePersistentState(
    'griddapCoverageVisible',
    false
  )
  const [griddapCoverage, setGriddapCoverage] = useState()
  const [activeWmsOverlay, setActiveWmsOverlay] = useState()
  // Layer visibility switch for the observation layers (hexes / points /
  // trajectories). On by default.
  const [dataLayersVisible, setDataLayersVisible] = usePersistentState(
    'dataLayersVisible',
    true
  )
  // Map projection: 'mercator' (default) or 'globe'. The globe view renders
  // high latitudes (e.g. the Arctic) without Mercator distortion.
  const [projection, setProjection] = usePersistentState(
    'projection',
    'mercator'
  )
  // Basemap raster: 'emodnet' (default) or 'arcgis-ocean'.
  // See components/Map/basemapStyle.js.
  const [basemap, setBasemap] = usePersistentState('basemap', defaultBasemap)
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
  //
  // legendLoading exists because "no range levels yet" and "no data matches the
  // filters" are indistinguishable from the values alone, and /legend is the
  // app's slowest query: without it the legend card claimed "No Data" for the
  // first few seconds of every load.
  function loadLegend (legendQuery) {
    setLegendLoading(true)
    fetchJson(`${server}/legend${legendQuery ? '?' + legendQuery : ''}`)
      .then((legend) => {
        if (legend) {
          setRangeLevels(legend.recordsCount)
          setTrajectoryRangeLevels(legend.trajectoryRecordsCount)
          setObisRangeLevels(legend.obisRecordsCount)
        }
      })
      .catch((error) => {
        console.error('legend fetch failed:', error)
      })
      .finally(() => setLegendLoading(false))
  }

  // Initial map view from a share link, and the initial legend values.
  useEffect(() => {
    const { lat, lon, zoom } = Object.fromEntries(
      new URL(window.location.href).searchParams
    )
    if (lat || lon || zoom) setMapView({ lat, lon, zoom })

    loadLegend(mapQueryString)
  }, [])

  // Refetch the legend whenever the (debounced) query changes, or a group is
  // hidden from / restored to the map — the ramp counts what the map draws.
  useEffect(() => {
    if (!loading && !isEmpty(rangeLevels)) {
      loadLegend(mapQueryString)
    }
  }, [mapQueryString])

  // Fetch griddap coverage bboxes when the layer is visible, in lockstep
  // with the same debounced query the tiles and /pointQuery use. Data is
  // kept when the layer is toggled off so re-showing it is instant.
  useEffect(() => {
    if (!griddapCoverageVisible) return
    const controller = new AbortController()
    fetch(`${server}/griddapCoverage?${mapQueryString}`, {
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
  }, [mapQueryString, griddapCoverageVisible])

  useEffect(() => {
    if (rangeLevels) {
      setCurrentRangeLevel(getCurrentRangeLevel(rangeLevels, zoom))
    }
  }, [rangeLevels, zoom])

  useEffect(() => {
    // Coverage hexes (trajectory and OBIS cells) only render at zoom >= 7 —
    // below that, their counts are merged into the green hex ramp — so hide
    // both legend entries otherwise.
    if (trajectoryRangeLevels && zoom >= 7) {
      setCurrentTrajectoryRangeLevel(trajectoryRangeLevels.zoom1)
    } else {
      setCurrentTrajectoryRangeLevel()
    }
  }, [trajectoryRangeLevels, zoom])

  useEffect(() => {
    if (obisRangeLevels && zoom >= 7) {
      setCurrentObisRangeLevel(obisRangeLevels.zoom1)
    } else {
      setCurrentObisRangeLevel()
    }
  }, [obisRangeLevels, zoom])

  const value = {
    loading,
    setLoading,
    mapLoaded,
    mapView,
    setMapView,
    zoom,
    rangeLevels,
    legendLoading,
    trajectoryRangeLevels,
    obisRangeLevels,
    currentRangeLevel,
    currentTrajectoryRangeLevel,
    currentObisRangeLevel,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    projection,
    setProjection,
    basemap,
    setBasemap,
    tracksMode,
    setTracksMode,
    scrubTime,
    setScrubTime,
    debouncedScrubTime,
    trailingDays,
    setTrailingDays,
    dataLayers,
    setDataLayers,
    griddapCoverage,
    activeWmsOverlay,
    setActiveWmsOverlay,
    zoomTarget,
    zoomToGeometry,
    pendingDatasetZoom,
    setPendingDatasetZoom,
    mapRef,
    mapDatasetPKs,
    setMapDatasetPKs,
    mapQueryString,
    loadLegend: () => loadLegend(mapQueryString)
  }

  return (
    <MapStateContext.Provider value={value}>
      {children}
    </MapStateContext.Provider>
  )
}
