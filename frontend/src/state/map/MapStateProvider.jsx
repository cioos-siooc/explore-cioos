import * as React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect
} from 'react'
import isEmpty from 'lodash/isEmpty'

import { server } from '../../config.js'
import {
  DEFAULT_HEX_METRIC,
  defaultMapCenter,
  defaultMapZoom,
  defaultTrailingDays,
  isMarkerTier,
  MARKER_METRIC,
  TRAIL_ALL
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
import {
  ALL_DATA_LAYERS,
  DATA_LAYER_KEYS,
  DEFAULT_DATA_LAYERS,
  DEFAULT_TRACKS_MODE,
  DEFAULT_TRAJECTORY_HEXES,
  TRAJECTORY_LAYER_KEYS,
  allDataLayersOn,
  anyTrajectoryLayerOn,
  commitDataLayers,
  onlyDataLayer
} from '../dataLayers.js'

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
  // The camera, as the map reports it (numbers, plus bounds once it has
  // settled). Seeded from the share link — or the default view when the link
  // carries no camera — rather than left empty: MapLibre only pushes a view on
  // 'idle'/'moveend', so an empty seed means every zoom-keyed consumer sees
  // `undefined` for as long as the basemap takes to load. The legend read that
  // as "no data matched" and said so. Number() rather than the raw params: they
  // are strings, and Number.isFinite('12') is false.
  const [mapView, setMapView] = useState(() => {
    const params = new URL(window.location.href).searchParams
    const asNumber = (name, fallback) => {
      const value = Number(params.get(name))
      return Number.isFinite(value) && params.get(name) !== null
        ? value
        : fallback
    }
    return {
      lat: asNumber('lat', defaultMapCenter.lat),
      lon: asNumber('lon', defaultMapCenter.lon),
      zoom: asNumber('zoom', defaultMapZoom)
    }
  })
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
  // the shown groups. Memoized: this provider re-renders on every moveend/zoom
  // (mapView), and createDataFilterQueryString does full passes over every
  // filter array — recomputing it per interaction was wasted work and produced
  // a new string identity that could churn downstream effects.
  const mapQueryString = useMemo(
    () => applyMapDatasetPKs(createDataFilterQueryString(query), mapDatasetPKs),
    [query, mapDatasetPKs]
  )
  const [rangeLevels, setRangeLevels] = useState()
  // Which metric the ranges in flight / on hand were requested for, so a metric
  // change can be told apart from a filter change (see the refetch effect).
  const loadedMetric = useRef()
  const [legendLoading, setLegendLoading] = useState(true)
  const [currentRangeLevel, setCurrentRangeLevel] = useState()
  // The always-hex coverage layer (trajectory + OBIS cells) at zoom >= 7. One
  // range, because both kinds now share one ramp — it was three, one per
  // colour scale.
  const [coverageRangeLevels, setCoverageRangeLevels] = useState()
  const [currentCoverageRangeLevel, setCurrentCoverageRangeLevel] = useState()
  // What the hex ramp counts: 'records' (how much data was collected) or
  // 'days' (how long it spans). A display preference, so localStorage rather
  // than the URL — same as the switches below. It is computed server-side, so
  // it also goes into the tile and /legend query strings.
  const [metric, setMetric] = usePersistentState('hexMetric', DEFAULT_HEX_METRIC)
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
  // On by default, so the param records the OFF case ('tracks=false'). Old
  // share links carrying 'tracks=true' still read as on.
  const [tracksMode, setTracksMode] = useState(
    urlParams.get('tracks') !== 'false'
  )
  // Trajectory coverage hexes, independent of the track lines: both are views
  // of the same data and combine freely. Off by default (see
  // DEFAULT_TRAJECTORY_HEXES), so the param records the ON case.
  const [trajectoryHexes, setTrajectoryHexes] = useState(
    urlParams.get('trajHexes') === 'true'
  )
  const [scrubTime, setScrubTime] = useState(
    urlParams.get('scrubTime') || new Date().toISOString().split('T')[0]
  )
  const debouncedScrubTime = useDebounce(scrubTime, 250)
  // The trail is either a day count or the TRAIL_ALL sentinel, which UrlSync
  // writes verbatim — parseInt('all') is NaN, so it needs matching before the
  // numeric parse or the 'all' trail silently reverts to the default on reload.
  const [trailingDays, setTrailingDays] = useState(() => {
    const trail = urlParams.get('trail')
    if (trail === TRAIL_ALL) return TRAIL_ALL
    return Number.parseInt(trail) || defaultTrailingDays
  })

  // Data-type layers shown on the map. Absent `layers` param = the default
  // selection (everything but trajectories — see DEFAULT_DATA_LAYERS); a present
  // param is the comma list of enabled layers, so a non-default selection
  // round-trips through the URL. An empty param means all off, which is why
  // this tests for null rather than falsiness.
  const [dataLayers, setDataLayers] = useState(() => {
    const layersParam = urlParams.get('layers')
    if (layersParam == null) return DEFAULT_DATA_LAYERS
    const on = new Set(layersParam.split(',').filter(Boolean))
    return Object.fromEntries(DATA_LAYER_KEYS.map((key) => [key, on.has(key)]))
  })

  // The geometry switches, and the two trajectory view sub-switches. These live
  // together because the view switches are coupled to the trajectory ones in
  // both directions: a trajectory layer showing nothing is a dead end, so
  // clearing the last view turns the trajectory layers off, and switching one
  // back on restores the default pair rather than the empty state.
  //
  // The views belong to Trajectory and TrajectoryProfile jointly — they are one
  // set of track/coverage layers fed by both — so the coupling is written
  // against "is either on", not against a single key.
  // Ticking a box while everything is on narrows to that one geometry — the
  // same first pick the catalogue filters make — and unticking the last one
  // folds back to everything (see commitDataLayers).
  function toggleDataLayer (key) {
    const next = allDataLayersOn(dataLayers)
      ? onlyDataLayer(key)
      : commitDataLayers({ ...dataLayers, [key]: !dataLayers[key] })
    setDataLayers(next)
    // Restore the default views only when this change is what brings the
    // trajectory layers back; with one already drawing, the user's current view
    // choice is deliberate and stays.
    if (anyTrajectoryLayerOn(next) && !anyTrajectoryLayerOn(dataLayers)) {
      setTracksMode(DEFAULT_TRACKS_MODE)
      setTrajectoryHexes(DEFAULT_TRAJECTORY_HEXES)
    }
  }

  // Flip one sub-switch, dropping both trajectory geometries when that would
  // leave neither representation drawing anything.
  function setTrajectoryViews (tracks, hexes) {
    setTracksMode(tracks)
    setTrajectoryHexes(hexes)
    if (!tracks && !hexes) {
      setDataLayers(
        commitDataLayers({
          ...dataLayers,
          ...Object.fromEntries(TRAJECTORY_LAYER_KEYS.map((k) => [k, false]))
        })
      )
    }
  }

  const toggleTrackLines = () =>
    setTrajectoryViews(!tracksMode, trajectoryHexes)
  const toggleTrajectoryHexes = () =>
    setTrajectoryViews(tracksMode, !trajectoryHexes)

  // Back to the default selection — every geometry, i.e. unfiltered — and to
  // the default trajectory views with it: the sub-switches are part of what
  // "reset" means here, and leaving them on whatever the user last chose would
  // make the reset only half true. Backs the filter row's Reset and the chip's
  // remove-all.
  function resetDataLayers () {
    setDataLayers({ ...DEFAULT_DATA_LAYERS })
    setTracksMode(DEFAULT_TRACKS_MODE)
    setTrajectoryHexes(DEFAULT_TRAJECTORY_HEXES)
  }

  // Every geometry on. Identical to the reset now that all-on IS the default,
  // and kept separate only so the filter's Select All button reads the way the
  // other filters' do.
  function showAllDataLayers () {
    setDataLayers({ ...ALL_DATA_LAYERS })
    setTracksMode(DEFAULT_TRACKS_MODE)
    setTrajectoryHexes(DEFAULT_TRAJECTORY_HEXES)
  }

  const { zoom } = mapView

  // The marker tier always counts days of data, whatever the switcher says —
  // see MARKER_METRIC for why. This is the value everything downstream uses
  // (tile URLs, /legend, the hover tooltips, the legend card), so the pin can't
  // drift out of sync with what the map is actually painting; `metric` stays
  // the user's choice, remembered for when they zoom back out to the hexes.
  const metricPinned = isMarkerTier(zoom)
  const effectiveMetric = metricPinned ? MARKER_METRIC : metric

  // A failed legend fetch (e.g. gateway timeout) just leaves the current
  // color ramp in place — the map itself keeps working — so failures log
  // instead of crashing, and loadLegend() is exposed for the retry banner.
  //
  // legendLoading exists because "no range levels yet" and "no data matches the
  // filters" are indistinguishable from the values alone, and /legend is the
  // app's slowest query: without it the legend card claimed "No Data" for the
  // first few seconds of every load.
  // The metric decides what /legend counts, so it has to travel with the
  // filters — a range taken over days can't scale a ramp painted over
  // measurement counts. Omitted at the default so the common case keeps the
  // URL (and cache key) it had before the switcher existed, matching
  // buildTileSuffix in Map.jsx.
  function legendUrl (legendQuery, hexMetric) {
    const params = new URLSearchParams(legendQuery || '')
    if (hexMetric !== DEFAULT_HEX_METRIC) params.set('metric', hexMetric)
    const s = params.toString()
    return `${server}/legend${s ? '?' + s : ''}`
  }

  function loadLegend (legendQuery, hexMetric = effectiveMetric) {
    loadedMetric.current = hexMetric
    setLegendLoading(true)
    fetchJson(legendUrl(legendQuery, hexMetric))
      .then((legend) => {
        if (legend) {
          setRangeLevels(legend.recordsCount)
          setCoverageRangeLevels(legend.coverageCount)
        }
      })
      .catch((error) => {
        console.error('legend fetch failed:', error)
      })
      .finally(() => setLegendLoading(false))
  }

  // The initial legend values. (The camera from the share link is read where
  // mapView is declared, so it is numeric from the first render.)
  useEffect(() => {
    loadLegend(mapQueryString)
  }, [])

  // Refetch the legend whenever the (debounced) query changes, or a group is
  // hidden from / restored to the map — the ramp counts what the map draws.
  // The metric is in here too: it changes what /legend counts, and a stale
  // range would scale the new numbers against the old domain.
  //
  // It's the *effective* metric, so crossing MARKER_MIN_ZOOM refetches — one
  // /legend response covers every zoom tier of a single metric, and the marker
  // tier is pinned to a different one than the hexes. Both URLs cache, so it's
  // one extra fetch per (filters x metric), not one per zoom.
  //
  // A metric change refetches even mid-load, unlike a query change. Changing
  // the metric *causes* a load (the tiles reload to carry the new count), so
  // the old `!loading` guard skipped the one refetch that mattered and never
  // retried — the bar kept the previous metric's numbers under the new
  // metric's tiles. A query change can wait: whatever is in flight already
  // carries the new filters, whereas an in-flight request cannot retroactively
  // have asked for a metric that was chosen after it was issued.
  useEffect(() => {
    if (isEmpty(rangeLevels)) return
    if (loading && loadedMetric.current === effectiveMetric) return
    loadLegend(mapQueryString)
  }, [mapQueryString, effectiveMetric])

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
    // Coverage hexes (trajectory and OBIS cells) only render at the marker
    // tier — below that, their counts are merged into the main hex ramp — so
    // hide the legend entry otherwise.
    if (coverageRangeLevels && isMarkerTier(zoom)) {
      setCurrentCoverageRangeLevel(coverageRangeLevels.zoom1)
    } else {
      setCurrentCoverageRangeLevel()
    }
  }, [coverageRangeLevels, zoom])

  const value = {
    loading,
    setLoading,
    mapLoaded,
    mapView,
    setMapView,
    zoom,
    rangeLevels,
    legendLoading,
    coverageRangeLevels,
    currentRangeLevel,
    currentCoverageRangeLevel,
    // The pinned value, not the raw preference — see effectiveMetric. Callers
    // that paint or label the map want what the map is counting.
    metric: effectiveMetric,
    metricPinned,
    setMetric,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    projection,
    setProjection,
    // Read-only outside this provider: the layer switches and the two
    // trajectory sub-switches are coupled (clearing both sub-switches drops the
    // parent), so callers go through the toggles rather than the raw setters.
    tracksMode,
    trajectoryHexes,
    toggleTrackLines,
    toggleTrajectoryHexes,
    scrubTime,
    setScrubTime,
    debouncedScrubTime,
    trailingDays,
    setTrailingDays,
    dataLayers,
    toggleDataLayer,
    resetDataLayers,
    showAllDataLayers,
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
