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

import { server } from '../../config.js'
import {
  defaultMapCenter,
  defaultMapZoom,
  defaultTrailingDays,
  HEX_METRIC,
  isMarkerTier,
  TRAIL_ALL
} from '../../components/config.js'
import {
  applyMapDatasetPKs,
  createDataFilterQueryString,
  getCurrentRangeLevel,
  rangesEqual,
  useDebounce
} from '../../utilities.jsx'
import { wmsSliceFromParams } from '../../wmsUtilities.js'
import fetchJson from '../fetchJson.js'
import reportError from '../reportError.js'
import { useUrlSeededPersistentState } from '../usePersistentState.js'
import { useFilters } from '../filters/FilterProvider.jsx'
import {
  DATA_LAYER_KEYS,
  DEFAULT_DATA_LAYERS,
  DEFAULT_TRACKS_MODE,
  allDataLayersOn,
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
  // usable map and only earns the brand logo's quiet pulse.
  const [loading, setLoadingState] = useState(true)
  const [mapLoaded, setMapLoaded] = useState(false)
  const setLoading = useCallback((value) => {
    setLoadingState(value)
    if (!value) setMapLoaded(true)
  }, [])

  // The other way into mapLoaded, and the one the first load actually takes:
  // Map calls this once the hexes are painted with their final ramp over a
  // basemap that has drawn (see reportFirstPaint there). 'idle' — what drives
  // setLoading above — is the wrong moment in both directions: it waits for the
  // CHS soundings on top of everything else, and it can arrive before the hex
  // sources have even been asked for. It stays as the backstop for a load that
  // never reports a first paint at all.
  const reportFirstPaint = useCallback(() => setMapLoaded(true), [])

  // Whether the app is still on its very first draw — the one state that earns
  // a full-screen splash. Derived here rather than recomputed by each of the
  // two things that answer to it (the splash itself, and the corner activity
  // panel, which stands down while the splash is naming the same waits).
  const firstPaintPending = loading && !mapLoaded
  // Separate from `loading` above, which is about the *data* the map draws.
  // This one is the basemap rasters — imagery and CHS soundings still arriving
  // after a pan or a zoom — and it is the slow one on a cold cache. Map.jsx
  // only raises it for waits long enough to be worth a word (see the effect
  // there); AppShell decides which of the two pills gets the spot.
  // Which of the map's layers are currently fetching tiles, as the layer ids in
  // Map.jsx's WATCHED_MAP_LAYERS. Separate from `loading` above, which is about
  // the map redrawing as a whole; this says what specifically is on the wire, so
  // the activity badge can name it. This replaced a single basemap-only flag,
  // which could say no more than "imagery" and knew nothing of the data layers.
  const [loadingLayers, setLoadingLayers] = useState([])

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
  // What the ranges on hand / in flight were requested for — the query, which is
  // the only thing that changes what /legend counts. This is the whole dedupe
  // test for the refetch effect below.
  const requestedLegendQuery = useRef(undefined)
  // The in-flight /legend request, so a newer one can cancel it (see loadLegend).
  const legendRequest = useRef(undefined)
  const [legendLoading, setLegendLoading] = useState(true)
  const [currentRangeLevel, setCurrentRangeLevel] = useState()
  // The always-hex coverage layer (trajectory + OBIS cells) at zoom >= 7. One
  // range, because both kinds now share one ramp — it was three, one per
  // colour scale.
  const [coverageRangeLevels, setCoverageRangeLevels] = useState()
  const [currentCoverageRangeLevel, setCurrentCoverageRangeLevel] = useState()
  // The map-appearance switches below are both preferences AND shareable: they
  // persist in localStorage so a reload comes back to the map the user left,
  // and UrlSync writes the non-default ones into the link so a shared view
  // arrives drawn the way it was sent (see useUrlSeededPersistentState — a
  // param in the link wins over the stored value).
  //
  // Griddap (gridded, metadata-only) datasets: the optional coverage layer
  // (off by default) and the on-demand per-dataset WMS overlay
  // ({pk, datasetId, wmsUrl, variable, time, elevation, bbox} | undefined).
  // The overlay itself is per-dataset and dies with the dataset page, so it
  // is deliberately not persisted.
  const [griddapCoverageVisible, setGriddapCoverageVisible] =
    useUrlSeededPersistentState(
      'griddapCoverageVisible',
      'griddap',
      false,
      (raw) => raw === 'true'
    )
  const [griddapCoverage, setGriddapCoverage] = useState()
  const [activeWmsOverlay, setActiveWmsOverlay] = useState()
  // The slice a share link named for that overlay — its variable, instant and
  // level (?var=&date=&z=). Consumed once, by the first overlay built: the
  // link's dataset is the one the page opens on, and a later toggle or another
  // dataset defaults as usual rather than inheriting a slice from a grid it
  // has nothing to do with. Same one-shot shape as pendingDatasetZoom below.
  const [pendingWmsSlice, setPendingWmsSlice] = useState(() =>
    wmsSliceFromParams(new URL(window.location.href).searchParams)
  )
  // Layer visibility switch for the observation layers (hexes / points /
  // coverage cells). On by default.
  const [dataLayersVisible, setDataLayersVisible] = useUrlSeededPersistentState(
    'dataLayersVisible',
    'obs',
    true,
    (raw) => raw !== 'false'
  )
  // The CHS NONNA depth rasters, which the legend's depth ramp keys. On by
  // default, and part of the basemap rather than of the data — so it is its own
  // switch, independent of the observation layers above.
  const [bathymetryVisible, setBathymetryVisible] = useUrlSeededPersistentState(
    'bathymetryVisible',
    'bathy',
    true,
    (raw) => raw !== 'false'
  )
  // Map projection: 'mercator' (default) or 'globe'. The globe view renders
  // high latitudes (e.g. the Arctic) without Mercator distortion. The param is
  // the switch the user sees ('globe=true'), not the internal value.
  const [projection, setProjection] = useUrlSeededPersistentState(
    'projection',
    'globe',
    'mercator',
    (raw) => (raw === 'true' ? 'globe' : 'mercator')
  )
  // One-shot "frame this geometry" request for the Map. The nonce lets the
  // same extent be re-requested (clicking zoom again after panning away).
  const [zoomTarget, setZoomTarget] = useState()
  // One-shot "start/stop drawing" request for the Map, from the spatial
  // filter button in the top bar. mode is 'box', 'polygon' or 'clear'; the
  // nonce lets the same mode be re-requested (picking "Bounding box" again
  // after cancelling out of it).
  const [drawRequest, setDrawRequest] = useState()
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

  // What the last click on the map found under it — the payload behind the
  // "what's here" card. Map.jsx builds it from one hit-test over every data
  // layer and hands it over; FeatureCard resolves the dataset pks in it
  // against the current results and renders the answer. null = nothing open.
  //
  // It lives here rather than in SelectionProvider because it is a question,
  // not a selection: opening the card changes nothing about the filters, the
  // camera, or the dataset page. Only the buttons inside it do.
  const [featureQuery, setFeatureQuery] = useState(null)

  // Where a share link's card was opened (?at=lng,lat). Everything in the card
  // is derived from what is drawn under that point — the rows, the count, the
  // outlined region — so there is nothing to carry in the link but the question
  // itself, and Map replays it once the map has drawn (see the mount effect
  // there). Read at mount only, which is why it is a plain value and not state.
  const sharedFeatureQueryAt = useState(() => {
    const parts = (new URL(window.location.href).searchParams.get('at') || '')
      .split(',')
      .map(Number)
    return parts.length === 2 && parts.every(Number.isFinite) ? parts : null
  })[0]

  function zoomToGeometry (geometry) {
    if (geometry) setZoomTarget({ geometry, nonce: Date.now() })
  }

  function requestDraw (mode) {
    setDrawRequest({ mode, nonce: Date.now() })
  }

  // Tracks mode (trajectory track lines + time scrub bar) and the data-type
  // layer selection, both restored from share-link params (UrlSync writes
  // them back).
  const urlParams = new URL(window.location.href).searchParams
  // On by default, so the param records the OFF case ('tracks=false'). Old
  // share links carrying 'tracks=true' still read as on.
  const [tracksMode, setTracksMode] = useState(
    urlParams.has('tracks')
      ? urlParams.get('tracks') !== 'false'
      : DEFAULT_TRACKS_MODE
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

  // The geometry filter. Ticking a box while everything is on narrows to that
  // one geometry — the same first pick the catalogue filters make — and
  // unticking the last one folds back to everything (see commitDataLayers).
  function toggleDataLayer (key) {
    setDataLayers(
      allDataLayersOn(dataLayers)
        ? onlyDataLayer(key)
        : commitDataLayers({ ...dataLayers, [key]: !dataLayers[key] })
    )
  }

  // Whether the trajectory data draws its track lines. It belongs to Trajectory
  // and TrajectoryProfile jointly — one set of map layers fed by both — which is
  // why it is a single switch rather than one per geometry, and it lives on the
  // legend section it keys rather than inside the geometry filter.
  //
  // It is the only trajectory-specific display switch left. The companion
  // "trajectory hexes" one is gone: those cells are hexes like every other
  // geometry's, counted into the same ramp and hidden by the same hex/point
  // switch, so a second control that could take trajectory data out of the
  // hexagons on its own was drawing a distinction the ramp couldn't show.
  //
  // Flipping it is a map-appearance change and nothing more: it used to drop
  // both trajectory geometries out of the filter selection when no view was
  // left, which meant a display switch quietly narrowing the datasets list and
  // its counts. Turning it off now just leaves the tracks undrawn — the same as
  // hiding the hexes and points — and the legend keeps the switch on screen.
  const toggleTrackLines = () => setTracksMode(!tracksMode)

  // Back to the default selection: every geometry, i.e. unfiltered. Backs the
  // filter row's Reset and the chip's remove-all. The trajectory view switches
  // are deliberately untouched — they are map appearance, not part of this
  // filter, so a filter reset has no business changing them.
  function resetDataLayers () {
    setDataLayers({ ...DEFAULT_DATA_LAYERS })
  }

  const { zoom } = mapView

  // A failed legend fetch (e.g. gateway timeout) just leaves the current
  // color ramp in place — the map itself keeps working — so failures log
  // instead of crashing, and loadLegend() is exposed for the retry banner.
  //
  // legendLoading exists because "no range levels yet" and "no data matches the
  // filters" are indistinguishable from the values alone, and /legend is the
  // app's slowest query: without it the legend card claimed "No Data" for the
  // first few seconds of every load.
  // The metric travels with the filters: a range taken over one count can't
  // scale a ramp painted over another. It is always written out, never omitted
  // — the API counts something else when the param is absent (see HEX_METRIC) —
  // and the tile URLs spell it out the same way (buildTileSuffix in Map.jsx).
  function legendUrl (legendQuery) {
    const params = new URLSearchParams(legendQuery || '')
    params.set('metric', HEX_METRIC)
    return `${server}/legend?${params.toString()}`
  }

  // Only the newest request may write the ranges. Two filter changes in a row
  // put two /legend calls in flight and they can land in either order — the
  // slower first response would otherwise overwrite the newer one and leave the
  // bar numbered for filters the tiles no longer carry. The previous request is
  // aborted as well, so a fast succession of changes isn't holding several
  // copies of the app's heaviest query open at once.
  function loadLegend (legendQuery) {
    legendRequest.current?.abort()
    const controller = new AbortController()
    legendRequest.current = controller
    requestedLegendQuery.current = legendQuery
    setLegendLoading(true)
    fetchJson(legendUrl(legendQuery), { signal: controller.signal })
      .then((legend) => {
        if (legend) {
          setRangeLevels(legend.recordsCount)
          setCoverageRangeLevels(legend.coverageCount)
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        reportError('legend fetch failed', error)
        // Let the effect below retry this query: a failed fetch leaves no ranges
        // behind, so nothing should count as loaded for it.
        requestedLegendQuery.current = undefined
      })
      .finally(() => {
        if (legendRequest.current !== controller) return
        legendRequest.current = undefined
        setLegendLoading(false)
      })
  }

  // Fetch the legend for whatever the map is drawing: on mount, whenever the
  // (debounced) query changes, and whenever a group is hidden from / restored to
  // the map — the ramp counts what the map draws, and a stale range would scale
  // the new numbers against the old domain. One response covers every zoom tier.
  //
  // The guard is the query the last request was issued for, and nothing else. It
  // used to also bail while `loading` was true, on the theory that a request
  // already in flight carried the new filters — but `loading` is the *tiles*, not
  // this fetch, so any change arriving during a redraw (which is exactly when a
  // filter change arrives, since it causes one) was dropped and never retried,
  // leaving the previous filters' numbers under the new tiles. It also bailed on
  // empty rangeLevels, which meant a first response that failed or matched
  // nothing froze the ramp for the rest of the session.
  useEffect(() => {
    if (requestedLegendQuery.current === mapQueryString) return
    loadLegend(mapQueryString)
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
        reportError('griddap coverage fetch failed', error)
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
    // there is no separate domain to report otherwise.
    if (coverageRangeLevels && isMarkerTier(zoom)) {
      setCurrentCoverageRangeLevel(coverageRangeLevels.zoom1)
    } else {
      setCurrentCoverageRangeLevel()
    }
  }, [coverageRangeLevels, zoom])

  // The domain the hexes on screen actually span, measured from the rendered
  // tiles and reported by Map.jsx (see refreshViewportHexRange there). It is
  // quantized and debounced at the source, so this only changes when the ramp
  // it drives changes; the setter drops equal values so a re-report can't
  // re-render the legend for nothing.
  const [viewportHexRange, setViewportHexRangeState] = useState()
  const setViewportHexRange = useCallback((range) => {
    setViewportHexRangeState((previous) =>
      rangesEqual(previous, range) ? previous : range
    )
  }, [])

  // The global domain for the hexes, whatever they hold. Below the marker tier
  // every kind of cell — profile-family, trajectory, occurrence — is summed
  // into the same hexes layer, so currentRangeLevel already covers all of them;
  // at the marker tier the only hexes still on screen are the trajectory/OBIS
  // coverage cells, which carry their own tier. One gradient either way,
  // because the colour means the same thing either way: how much data this cell
  // holds.
  const globalHexRangeLevel = isMarkerTier(zoom)
    ? currentCoverageRangeLevel
    : currentRangeLevel

  // What the gradient is actually drawn over. The visible extent wins when
  // there is one: a domain taken from the whole catalogue leaves a zoomed-in
  // view painted in one flat shade, since every hex in it sits in the bottom
  // decade of a global maximum set somewhere else entirely. The global tier is
  // the fallback — before the first measurement, and wherever too few hexes are
  // on screen to call it a distribution.
  const hexRangeLevel = viewportHexRange || globalHexRangeLevel

  const value = {
    loading,
    setLoading,
    reportFirstPaint,
    firstPaintPending,
    loadingLayers,
    setLoadingLayers,
    mapLoaded,
    mapView,
    setMapView,
    zoom,
    rangeLevels,
    legendLoading,
    coverageRangeLevels,
    currentRangeLevel,
    // What the legend's single hex gradient is keyed to — see above. The
    // coverage tier is not exported on its own: it is one of the two things this
    // can be, and nothing outside wants it separately now that the card draws
    // one gradient for every hexagon.
    hexRangeLevel,
    // Whether that domain came from the view rather than the whole catalogue,
    // so the legend can say as much — the numbers on the bar move with the
    // camera, and a bar that renumbers itself on a pan without explaining why
    // reads as a glitch.
    hexRangeScaledToView: Boolean(viewportHexRange),
    // Map.jsx reports the visible hex extent here; nothing else writes it.
    setViewportHexRange,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    bathymetryVisible,
    setBathymetryVisible,
    projection,
    setProjection,
    // Read-only outside this provider: the track-lines switch is flipped through
    // its toggle rather than the raw setter, so the reasoning about what a view
    // change may and may not touch stays in one place (see toggleTrackLines).
    tracksMode,
    toggleTrackLines,
    scrubTime,
    setScrubTime,
    debouncedScrubTime,
    trailingDays,
    setTrailingDays,
    dataLayers,
    toggleDataLayer,
    resetDataLayers,
    griddapCoverage,
    activeWmsOverlay,
    setActiveWmsOverlay,
    pendingWmsSlice,
    setPendingWmsSlice,
    zoomTarget,
    zoomToGeometry,
    drawRequest,
    requestDraw,
    pendingDatasetZoom,
    setPendingDatasetZoom,
    mapRef,
    featureQuery,
    sharedFeatureQueryAt,
    setFeatureQuery,
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
