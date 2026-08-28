import * as React from 'react'
import maplibreGl, { Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import { useState, useEffect, useRef } from 'react'

import * as helpers from '@turf/helpers'
import turfBboxPolygon from '@turf/bbox-polygon'
import turfPointsWithinPolygon from '@turf/points-within-polygon'
import turfBbox from '@turf/bbox'
import turfUnion from '@turf/union'

import DrawRectangle from 'mapbox-gl-draw-rectangle-mode'
import debounce from 'lodash/debounce'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import './styles.css'

import { server } from '../../config'
import reportError from '../../state/reportError.js'
import {
  boundsFromGeoJson,
  escapeHtml,
  generateColorStops,
  getCurrentRangeLevel,
  polygonIsRectangle,
  quantizeCountRange,
  rangesEqual,
  selectionFromSearchParams,
  zoomToDatasetCamera,
  splitTrackRuns,
  initialBearing
} from '../../utilities'
import {
  buildWmsGetMapUrl,
  clampBoundsForWms,
  intersectBoundsWithPolygonBbox,
  warpEquirectToMercator
} from '../../wmsUtilities'
import {
  clickHighlightColor,
  colorScale,
  hexOutlineColor,
  HEX_METRIC,
  MARKER_MIN_ZOOM,
  trackLineColor,
  selectedTrackColor,
  tracksMinDate,
  defaultMapCenter,
  defaultMapZoom,
  TRAIL_ALL,
  effectiveTrailingDays
} from '../config'
import platformColors from '../../components/platformColors'
import {
  PROFILE_TYPE_KEYS,
  TRAJECTORY_TYPE_KEYS,
  anyTrajectoryLayerOn
} from '../../state/dataLayers.js'
import {
  buildBasemapStyle,
  getLabelTextField,
  FIRST_LABEL_LAYER_ID,
  LABEL_LAYER_IDS
} from './basemapStyle.js'

// direct_select's own dragVertex/toDisplayFeatures, captured once here at
// module load — before the component below patches these modes on every
// render (see the simple_select.toDisplayFeatures override further down).
// Capturing the ORIGINAL library functions at module scope, rather than
// inside the component, means each render's override always falls back to
// true library behavior, not to the previous render's override — so
// re-renders don't stack wrapper upon wrapper.
const defaultDragVertex = MapboxDraw.modes.direct_select.dragVertex
const defaultDirectSelectToDisplayFeatures = MapboxDraw.modes.direct_select.toDisplayFeatures

// A rectangle drawn with draw_rectangle is a 4-point ring — mapbox-gl-draw
// strips the closing duplicate point internally (see Polygon's constructor
// in the library). polygonIsRectangle expects a closed 5-point ring, so
// re-close it here before delegating to that check.
function isRectangleFeature(feature) {
  const ring = feature?.type === 'Polygon' && feature.coordinates?.[0]
  return Boolean(ring) && ring.length === 4 && polygonIsRectangle([...ring, ring[0]])
}

// --- Viewport-adaptive hex ramp knobs ------------------------------------
// How long the camera has to hold still before the visible hexes are measured.
// It is a debounce, not a throttle: a drag or a pinch produces one measurement
// at the end of the gesture, not one per frame. Long enough that a hesitant
// pan across a coastline doesn't renumber the legend halfway through, short
// enough to feel like it belongs to the movement that caused it.
const VIEWPORT_RAMP_DEBOUNCE_MS = 400
// direct_select fires draw.update on every mousemove/touchmove tick of a drag
// (a dragged vertex or a dragged whole-shape), not just once at drag-end.
// setPolygon feeds SelectionProvider's /pointQuery fetch, so committing it on
// every tick would fire a request per frame of the drag — settle on this
// debounce instead, same idea as VIEWPORT_RAMP_DEBOUNCE_MS above.
const DRAW_UPDATE_DEBOUNCE_MS = 300
// Any hex on screen is worth measuring, including a single one. The threshold
// used to be four, on the theory that fewer than that is not a distribution —
// but zoomed in there often are only one or two cells in view, and the domain
// they fell back to was the whole catalogue's, which paints them at the pale
// bottom of the ramp: the "hexes have no colour when zoomed in" complaint. A
// lone hex is not a problem the ramp has to dodge either, because
// generateColorStops already answers it — a one-value range takes the middle of
// the ramp, since with nothing to compare against the honest shade is a mid
// one.
const MIN_VIEWPORT_HEXES = 1
// The layers the measurement reads. Only one of them is ever on screen (the
// combined hexes below the marker tier, the trajectory/OBIS coverage cells at
// and above it), and queryRenderedFeatures returns nothing for a layer outside
// its zoom range, so asking for both costs nothing and needs no zoom test.
const HEX_LAYER_IDS = ['hexes', 'coverage-hexes']
// The sources those layers draw from — tiles landing in either one can change
// what a measurement would find.
const HEX_SOURCE_IDS = ['cde-tiles', 'cde-cells']
// How far a screen corner may move across an unproject/project round trip and
// still count as a point on the map surface. One pixel: the round trip is exact
// to floating-point noise for a point that is really on the surface, and off by
// tens or hundreds of pixels for one that isn't (see viewportQueryIsReliable).
const SURFACE_ROUND_TRIP_TOLERANCE_PX = 1

// North-pointing arrowhead icon for track heads and selected-track fixes;
// the symbol layers rotate it to each point's course over ground. Drawn at
// 2x and added with pixelRatio 2 so it stays crisp on hidpi displays.
function buildHeadArrowImage(fillColor, strokeColor = '#ffffff') {
  const ratio = 2
  const size = 16 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.beginPath()
  ctx.moveTo(size / 2, 1.5 * ratio) // apex (north)
  ctx.lineTo(size - 2.5 * ratio, size - 2.5 * ratio)
  ctx.lineTo(size / 2, size - 5.5 * ratio) // tail notch
  ctx.lineTo(2.5 * ratio, size - 2.5 * ratio)
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1.5 * ratio
  ctx.strokeStyle = strokeColor
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

// Combine the filter-derived query string with the geometry selection into a
// tile-URL suffix. OBIS off adds includeObis=false, OR-ed with any the Source
// filter already emitted; a profile-type subset adds profileTypes=<comma list>
// and a trajectory-type subset trajectoryTypes=<comma list> (empty = none). A
// param is omitted when its layer(s) are fully on, so the URL stays clean.
// Returns '' or '?...'.
//
// Trajectory cells are requested whenever a trajectory geometry is selected,
// full stop — their counts belong to the hexes the same way every other
// geometry's do, and there is one switch for all of them (the hex/point
// visibility one). There used to be a second, trajectory-only hex switch here,
// which meant trajectory data could be missing from a hexagon for a reason the
// hex ramp had no way of showing. The track lines are unaffected either way:
// they come from a separate source (/tiles/tracks).
function buildTileSuffix(baseQuery, dataLayers) {
  const params = new URLSearchParams(baseQuery)
  // Always written out: the API counts something else when the param is absent
  // — see HEX_METRIC.
  params.set('metric', HEX_METRIC)
  if (dataLayers) {
    if (!dataLayers.obis || params.get('includeObis') === 'false') {
      params.set('includeObis', 'false')
    }
    const enabledTypes = PROFILE_TYPE_KEYS.filter(
      ([key]) => dataLayers[key]
    ).map(([, type]) => type)
    if (enabledTypes.length < PROFILE_TYPE_KEYS.length) {
      params.set('profileTypes', enabledTypes.join(','))
    }
    const enabledTrajectoryTypes = TRAJECTORY_TYPE_KEYS.filter(
      ([key]) => dataLayers[key]
    ).map(([, type]) => type)
    if (enabledTrajectoryTypes.length < TRAJECTORY_TYPE_KEYS.length) {
      params.set('trajectoryTypes', enabledTrajectoryTypes.join(','))
    }
    if (!enabledTrajectoryTypes.length) {
      params.set('includeTrajectory', 'false')
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

// Using Maplibre with React: https://documentation.maptiler.com/hc/en-us/articles/4405444890897-Display-MapLibre-GL-JS-map-using-React-JS
export default function CreateMap({
  // The query string the map draws from: the filters, narrowed to the dataset
  // groups still shown (MapStateProvider assembles it — the sidebar list keeps
  // the hidden groups, the tiles don't).
  mapQueryString,
  // No setPointsToReview: that list is the download selection, derived in
  // SelectionProvider from the `selected` flags on the results. The map used to
  // blank it from four places, back when it meant "the datasets inside the
  // drawn shape" — every one of those now just desynced it from the ticked
  // checkboxes until the next refetch happened to put them back.
  polygon,
  setPolygon,
  setLoading,
  setBasemapLoading = () => { },
  setMapView,
  // Hands the "what's here" card its payload: everything one click found under
  // it, or null for a click on empty water. See handleMapClick.
  onFeatureQuery = () => { },
  // The same payload handed back, so the map can outline the region the open
  // card is describing.
  featureQuery,
  // A click that landed on exactly one individual marker naming exactly one
  // dataset — nothing else under the cursor, no ambiguity about which station
  // the user meant. Called with (datasetPk, pointPk) instead of building a
  // featureQuery, so the caller can jump straight to that station's record
  // rather than making the user open a card and pick a row. See handleMapClick.
  onMarkerClick = () => { },
  rangeLevels,
  coverageRangeLevels,
  // Reports the count range the hexes on screen actually span, so the legend
  // can be numbered for the same domain the ramp is painted over. Called with
  // undefined whenever there is nothing to measure and the global tier takes
  // over. Debounced and deduped here — see refreshViewportHexRange.
  onViewportHexRange = () => { },
  hoveredDataset,
  setHoveredDataset,
  inspectDataset,
  setDatasetsSelected,
  tracksMode,
  scrubTime,
  trailingDays,
  selectedTrajectory,
  dataLayers,
  griddapCoverage,
  dataLayersVisible = true,
  bathymetryVisible = true,
  activeWmsOverlay,
  projection = 'mercator',
  zoomTarget,
  drawRequest,
  mapRef
}) {
  const { t, i18n } = useTranslation()

  const [searchParams] = useSearchParams()

  const mapContainer = useRef(null)
  const map = useRef(null)
  const creatingPolygon = useRef(false)
  const shiftBoxCreate = useRef(false)

  // Suppresses vertex/midpoint handles for a merely-*selected* shape (one
  // click, still simple_select) — direct_select keeps its library-default
  // toDisplayFeatures, which is what draws those handles for dragging. A
  // second click on the selected shape (mapbox-gl-draw's own
  // clickOnFeature/clickOnVertex transitions) enters direct_select and
  // reveals them. The vertex/midpoint layer styles below are already scoped
  // to `!= mode simple_select` for exactly this split.
  const disabledEvent = function (state, geojson, display) {
    display(geojson)
  }

  const modes = MapboxDraw.modes
  MapboxDraw.modes.simple_select.toDisplayFeatures = disabledEvent

  // A drawn bounding box must stay an axis-aligned rectangle while it's being
  // edited: dragging the whole shape already preserves that (translation),
  // but the library's default dragVertex moves only the one dragged corner,
  // which would let it warp into an arbitrary quadrilateral. For a
  // rectangle's single-corner drags, also slide its two ring-adjacent
  // corners along the axis they already share with it (the one on the same
  // old X gets the new X, the one on the same old Y gets the new Y), leaving
  // the opposite corner as the resize anchor. Anything else — a polygon, or
  // more than one selected vertex — keeps the library's own behavior.
  modes.direct_select.dragVertex = function (state, e, delta) {
    const path = state.selectedCoordPaths[0]
    if (state.selectedCoordPaths.length !== 1 || !isRectangleFeature(state.feature)) {
      defaultDragVertex.call(this, state, e, delta)
      return
    }
    const [ringIndex, index] = path.split('.').map((x) => parseInt(x, 10))
    const oldCoord = state.feature.getCoordinate(path)
    const newCoord = [oldCoord[0] + delta.lng, oldCoord[1] + delta.lat]
      ;[(index + 3) % 4, (index + 1) % 4].forEach((neighborIndex) => {
        const neighborPath = `${ringIndex}.${neighborIndex}`
        const neighborOld = state.feature.getCoordinate(neighborPath)
        if (neighborOld[0] === oldCoord[0]) {
          state.feature.updateCoordinate(neighborPath, newCoord[0], neighborOld[1])
        } else {
          state.feature.updateCoordinate(neighborPath, neighborOld[0], newCoord[1])
        }
      })
    state.feature.updateCoordinate(path, newCoord[0], newCoord[1])
  }

  // Dragging the body of a drawn shape (as opposed to one of its corner/
  // midpoint handles) defaults to translating the whole thing — disable
  // that so a spatial filter can only be resized from its handles, never
  // moved wholesale. Still track dragMoveLocation so a later handle-drag in
  // the same gesture doesn't jump using a stale reference point.
  modes.direct_select.dragFeature = function (state, e) {
    state.dragMoveLocation = e.lngLat
  }

  // A midpoint handle lets a user add a 5th vertex, which would permanently
  // break a rectangle's "always 4 corners" invariant — so suppress midpoint
  // handles specifically while editing a rectangle. Free-form polygons keep
  // their midpoints, so vertices can still be added to those as before.
  modes.direct_select.toDisplayFeatures = function (state, geojson, push) {
    if (state.featureId === geojson.properties.id && isRectangleFeature(state.feature)) {
      defaultDirectSelectToDisplayFeatures.call(this, state, geojson, (feature) => {
        if (feature.properties?.meta === 'midpoint') return
        push(feature)
      })
      return
    }
    defaultDirectSelectToDisplayFeatures.call(this, state, geojson, push)
  }

  // A drawn shape should always render "active" (yellow, with drag handles)
  // rather than dropping back to simple_select's plain/blue look. The
  // library's own clickNoTarget/clickInactive (clicking empty water, or a
  // second inactive feature, while editing) exit to simple_select — reuse
  // its clickActiveFeature instead, which just clears any selected vertex
  // and stays in direct_select.
  modes.direct_select.clickNoTarget = modes.direct_select.clickActiveFeature
  modes.direct_select.clickInactive = modes.direct_select.clickActiveFeature

  modes.draw_rectangle = DrawRectangle

  const drawControlOptions = {
    displayControlsDefault: false,
    // No buttons of its own: draw_rectangle/draw_polygon/simple_select are
    // driven imperatively from the top bar's spatial filter button (see the
    // drawRequest effect), not by clicking a control here.
    controls: {
      point: false,
      line_string: false,
      polygon: false,
      trash: false,
      combine_features: false,
      uncombine_features: false,
      modes,
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false
    },
    styles: [
      {
        id: 'gl-draw-polygon-fill',
        type: 'fill',
        filter: ['all', ['==', '$type', 'Polygon']],
        paint: {
          'fill-color': ['case', ['==', ['get', 'active'], 'true'], '#fbb03b', '#3bb2d0'],
          'fill-opacity': 0.1
        }
      },
      {
        id: 'gl-draw-lines',
        type: 'line',
        filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'active'], 'true'], '#fbb03b', '#3bb2d0'],
          'line-dasharray': ['literal', [0.2, 2]],
          'line-width': 2
        }
      },
      {
        id: 'gl-draw-point-outer',
        type: 'circle',
        filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
          'circle-color': '#fff'
        }
      },
      {
        id: 'gl-draw-point-inner',
        type: 'circle',
        filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 5, 3],
          'circle-color': ['case', ['==', ['get', 'active'], 'true'], '#fbb03b', '#3bb2d0']
        }
      },
      {
        id: 'gl-draw-vertex-outer',
        type: 'circle',
        filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
          'circle-color': '#fff'
        }
      },
      {
        id: 'gl-draw-vertex-inner',
        type: 'circle',
        filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 5, 3],
          'circle-color': '#fbb03b'
        }
      },
      {
        id: 'gl-draw-midpoint',
        type: 'circle',
        filter: ['all', ['==', 'meta', 'midpoint']],
        paint: { 'circle-radius': 3, 'circle-color': '#fbb03b' }
      }
    ]
  }
  const smallCircleSize = 2.75
  const largeCircleSize = 6
  const circleOpacity = 0.7
  // One transparency for the whole ramp: the hex colours are opaque, so this is
  // the only thing letting the basemap through, and it lets it through equally
  // at every count. Count is carried by colour alone.
  const hexOpacity = 0.8
  const hexMinZoom = 0
  // Shared with the Legend (which switches its key here): the hex band ending
  // and the marker tier starting are the same boundary, and they must not
  // drift.
  const hexMaxZoom = MARKER_MIN_ZOOM
  // Zoom at which griddap coverage rectangles take hover/click priority over
  // the hex aggregates (which stop being drawn at hexMaxZoom anyway).
  const griddapPriorityZoom = 5
  // 0.6 at the z7 hand-off (where trajectory and OBIS counts stop being merged
  // into the green hexes layer), easing back as the markers thin out but
  // holding at 0.4 — enough that the fill still reads as a colour on the ramp.
  // It used to bottom out at 0.15, which is where a coverage hex stops being a
  // shade of anything: zoomed in, the cells were a faint grey wash and the ramp
  // they belong to was unreadable off the map. The point circles stay legible
  // over them because they sit above the fill and carry their own white halo,
  // which is a stronger separation than transparency was buying.
  // Kept as [zoom, opacity] pairs rather than a finished expression because the
  // fade below has to rebuild it: a 'zoom' expression may only be the input to a
  // TOP-LEVEL step/interpolate, so the sparse-hex 'case' cannot wrap this — it
  // has to go inside each stop's output instead. See fadeExpression.
  const COVERAGE_HEX_OPACITY_STOPS = [
    [hexMaxZoom, 0.6],
    [hexMaxZoom + 1.5, 0.5],
    [hexMaxZoom + 3, 0.4]
  ]
  const draw = new MapboxDraw(drawControlOptions)
  const drawPolygon = useRef(draw)
  const doFinalCheck = useRef(false)
  const layersLoaded = useRef(false)
  const colorStops = useRef([])
  const coverageColorStops = useRef([])
  // The quantized count range of the hexes currently on screen, or undefined
  // when there is nothing worth measuring and the global tier keeps the ramp.
  // A ref, not state: it is read by setColorStops and by map event handlers,
  // and a re-render of this component is not what it should cause — the legend
  // hears about it through onViewportHexRange instead.
  const viewportHexRange = useRef(undefined)
  // The count at fadePercentileRef of the hexes currently on screen — the top
  // of the faded band. undefined when
  // there was nothing to measure, which means no fading at all rather than a
  // guessed threshold.
  //
  // A real percentile of the rendered counts, NOT a fraction of the min..max
  // range. The counts are heavily skewed — across the loaded catalogue the hex
  // totals run 0..149029 with a MEDIAN of 2 — so a quarter of the way along the
  // range lands at ~37000 and would fade all but a handful of hexes. The
  // quartile has to come from the distribution, the same reason the ramp itself
  // is log-spaced (generateColorStops) rather than evenly cut.
  const viewportFadeThreshold = useRef(undefined)
  // Latest setColorStops closure (it reads the rangeLevels props), for the map
  // handlers registered once on mount.
  const setColorStopsRef = useRef(undefined)
  // Whether anything has happened that could have changed the hexes on screen
  // since the last measurement. Starts true — the first tiles to arrive have
  // never been measured.
  const hexRangeDirty = useRef(true)
  // Whether the hex layers have been let through their opening fade — see
  // revealHexes. False until the ramp on them is the one they will keep.
  const hexesRevealed = useRef(false)
  // Latest rangeLevels, for the once-registered measurement handler: it runs on
  // the first render's closure (like setColorStops, which it reaches through a
  // ref of its own), so the prop it captured is forever the mount-time one.
  const rangeLevelsRef = useRef(rangeLevels)
  rangeLevelsRef.current = rangeLevels
  // Point-tier count range, kept so the circle-radius ramp can be rebuilt on
  // the layers whenever the filters change (see setColorStops).
  const pointRadiusRange = useRef(null)
  // pk of the dataset the map is currently singling out (hovered in the list,
  // or the one whose page is open). Held in a ref because the map's own event
  // handlers — zoomend, sourcedata, idle — need the current value, not the one
  // captured when they were registered.
  const focusedDatasetPk = useRef(undefined)
  // Signature of the focus state last written to the map, so re-applying an
  // unchanged focus costs nothing (see hoverHighlightPoints).
  const appliedFocus = useRef('')
  // The same guard for the track layers' focus paint, which is written whole
  // rather than per feature (see applyTrackFocus). Reset when those layers are
  // (re)created, since a fresh layer carries none of it.
  const trackFocusApplied = useRef(undefined)
  // The dataset the hex ramp is scaled to — the one whose page is open, and
  // only that one. A hover is a passing thing and leaves the ramp alone; an
  // open page is a state, and while it lasts the ramp describes that dataset's
  // cells rather than every dataset's (see refreshViewportHexRange).
  const rampFocusPk = useRef(undefined)
  // Which focus the held measurement was taken for, so it is taken once.
  const rampMeasuredForPk = useRef(undefined)
  // Latest tracks-mode props for the one-shot map 'load' closure (layers are
  // created once; these refs let it apply the current mode/scrub window).
  const tracksModeRef = useRef(tracksMode)
  const scrubTimeRef = useRef(scrubTime)
  const trailingDaysRef = useRef(trailingDays)
  const dataLayersRef = useRef(dataLayers)
  // Latest onViewportHexRange, for the same reason: the debounced handler that
  // reports the measurement is registered once.
  const onViewportHexRangeRef = useRef(onViewportHexRange)
  onViewportHexRangeRef.current = onViewportHexRange
  // Raw selected-track response, cached so re-renders don't re-fetch.
  const rawTrackRef = useRef(null)

  // UTC-day-snapped scrub window: [scrub date - N days, scrub date + 1 day),
  // or [tracksMinDate, scrub date + 1 day) for the 'all' trail (full tracks
  // up to the scrub date; see config.js). Day snapping keeps the tile URLs
  // stable so the server's URL-keyed tile cache gets hits across scrubs and
  // users. The requested trail is clamped by zoom first — a long window costs
  // far more zoomed out, where one tile can carry the whole catalogue (see
  // effectiveTrailingDays).
  function tracksTimeWindow(scrub, trailing, zoom) {
    const MS_PER_DAY = 24 * 60 * 60 * 1000
    const days = effectiveTrailingDays(trailing, zoom)
    const end = new Date(`${scrub}T00:00:00Z`).getTime()
    const timeMax = `${new Date(end + MS_PER_DAY).toISOString().split('T')[0]}T00:00:00Z`
    const timeMin =
      days === TRAIL_ALL
        ? `${tracksMinDate}T00:00:00Z`
        : `${new Date(end - days * MS_PER_DAY).toISOString().split('T')[0]}T00:00:00Z`
    return { timeMin, timeMax }
  }

  // Tracks tile URL: dataset-level filters from the regular map query string,
  // minus the TimeSelector's timeMin/timeMax (the scrub window must not
  // fight the date-range filter), plus the day-snapped scrub window.
  //
  // Trajectory and TrajectoryProfile are separate switches drawing into the
  // same track layers, so which of them the tiles carry is a server-side
  // decision like everything else — the selection rides along as
  // trajectoryTypes, omitted when both are on. Read from the ref rather than
  // taken as an argument so every existing caller keeps working unchanged.
  function buildTracksTileUrl(queryString, scrub, trailing, zoom) {
    const params = new URLSearchParams(queryString)
    params.delete('timeMin')
    params.delete('timeMax')
    const { timeMin, timeMax } = tracksTimeWindow(scrub, trailing, zoom)
    params.set('timeMin', timeMin)
    params.set('timeMax', timeMax)
    const layers = dataLayersRef.current
    if (layers) {
      const enabled = TRAJECTORY_TYPE_KEYS.filter(([key]) => layers[key]).map(
        ([, type]) => type
      )
      if (enabled.length < TRAJECTORY_TYPE_KEYS.length) {
        params.set('trajectoryTypes', enabled.join(','))
      }
    }
    return `${server}/tiles/tracks/{z}/{x}/{y}.mvt?${params.toString()}`
  }

  // The effective trail the tracks source was last built with, so the zoomend
  // handler can tell a gate crossing (refetch) from any other zoom change (no-op).
  const appliedTrailRef = useRef(null)

  function refreshTracksSource(queryString, scrub, trailing) {
    if (!map.current || !map.current.getSource('tracks')) return
    const zoom = map.current.getZoom()
    appliedTrailRef.current = effectiveTrailingDays(trailing, zoom)
    // Swap the tile URL and re-render via the public setTiles API — it
    // clears the source's tile cache and reloads the viewport tiles.
    map.current
      .getSource('tracks')
      .setTiles([buildTracksTileUrl(queryString, scrub, trailing, zoom)])
  }

  // Rebuild the shared point/hex and coverage-cell source URLs from the
  // current filters AND the data-layer selection (including the trajectory hex
  // switch), then force a refetch. Shared by the filter-change and
  // layer-toggle effects.
  function refreshCombinedSources(queryString) {
    // Guard on source existence, NOT map.loaded(): loaded() is false whenever
    // any tile is still in flight, and on this deployment the coverage/track
    // tiles are heavy enough that the map is rarely idle — gating on it
    // silently dropped filter changes that landed mid-load. The sources are
    // created together in the 'load' handler, so their presence is the real
    // precondition, and setTiles works fine while other tiles load.
    if (
      !map.current ||
      !map.current.getSource('cde-tiles') ||
      !map.current.getSource('cde-cells')
    )
      return
    const { tileQuery, cellTileQuery } = tileUrls(queryString)
    // Swap the tile URLs and re-render via the public setTiles API — it
    // clears each source's tile cache and reloads the viewport tiles.
    map.current.getSource('cde-tiles').setTiles([tileQuery])
    map.current.getSource('cde-cells').setTiles([cellTileQuery])
  }

  // Apply the track-line visibility: the track layers show only when at least
  // one trajectory geometry is on AND the track-lines switch is on. This is the
  // ONLY thing that hides them — the blanket "Hexes & points" picker owns the
  // hex and point layers alone (observationLayerIds), so turning it off no
  // longer takes the tracks with it. WHICH tracks are drawn (Trajectory,
  // TrajectoryProfile or both) is decided server-side from the tile-URL params,
  // the same as the hex layers — see buildTileSuffix.
  function applyLayerVisibility() {
    if (!map.current || !map.current.getLayer('track-lines')) return
    const trajOn = anyTrajectoryLayerOn(dataLayersRef.current)
    const showTracks = trajOn && tracksModeRef.current
      ;['track-lines', 'track-heads', 'track-heads-fixed'].forEach((id) =>
        map.current.setLayoutProperty(id, 'visibility', showTracks ? 'visible' : 'none')
      )
  }

  // Placeholder count ranges used only until the /legend request resolves.
  // The map now mounts before that response arrives, but the count-driven
  // layers ('hexes'/'coverage-hexes') must still be created with VALID,
  // non-empty color stops — MapLibre silently drops any layer whose paint
  // function has zero stops, which is why creating them from empty stops left
  // them missing entirely. The real ramp replaces these as soon as the legend
  // lands (setColorStops re-runs via the [rangeLevels] effect).
  //
  // Nobody ever sees them: the hex layers are drawn at zero opacity until the
  // ramp is the real one (see revealHexes), which is what these stops exist to
  // hold the layers open for.
  const defaultRangeLevels = { zoom0: [1, 100], zoom1: [1, 100], zoom2: [1, 100] }
  const defaultCoverageRangeLevels = { zoom1: [1, 100] }

  // The hex layers' opening fade. They are created at zero opacity and stay
  // there until the colours on them are the colours they will keep, because a
  // first load otherwise painted every hexagon twice: once from the placeholder
  // ranges above (or the catalogue-wide tier), and again a moment later from the
  // real domain — a full-map colour change a second into the load, which reads
  // as a glitch rather than as data arriving.
  //
  // Zero opacity rather than 'visibility: none': queryRenderedFeatures skips a
  // hidden layer entirely, and measuring the hexes on screen is exactly what
  // decides when to reveal them (see refreshViewportHexRange). A transparent
  // fill is still a rendered one.
  //
  // One-way, and deliberately so. Later changes that re-ramp the hexes — a
  // filter change, a pan into new tiles — repaint a map the user is already
  // reading, where a fade to nothing and back would be the more jarring of the
  // two. This is about the first sight of the map only.
  //
  // The paint change rides MapLibre's default transition, so the hexes fade up
  // over ~300ms rather than snapping on.
  function revealHexes() {
    if (hexesRevealed.current || !map.current) return
    hexesRevealed.current = true
    if (map.current.getLayer('hexes')) {
      map.current.setPaintProperty('hexes', 'fill-opacity', hexOpacityExpression())
    }
    if (map.current.getLayer('coverage-hexes')) {
      map.current.setPaintProperty(
        'coverage-hexes',
        'fill-opacity',
        coverageHexOpacityExpression()
      )
    }
  }

  // Reveal once a measurement pass has settled what the ramp is going to be.
  //
  // A measured range IS the ramp — it wins over the global tier in
  // setColorStops, so nothing arriving later can change the colours just
  // painted. Without one, the hexes are painted over the catalogue-wide tier
  // instead, which is only the final answer once /legend has actually returned
  // it; before that the layers are still holding the placeholder ranges and
  // must stay invisible.
  //
  // The no-measurement-but-legend-in-hand case is not hypothetical: an empty
  // result set has no hexes to measure, and opening a dataset page from a share
  // link scales the ramp to that one dataset, whose cells may be off screen. It
  // does mean "no hexes here", though, which is only true once the tiles have
  // actually arrived — otherwise a legend that lands first would reveal an empty
  // map and let the tiles behind it paint over the catalogue-wide tier, which is
  // the double colouring this exists to avoid.
  function revealHexesIfRamped(measuredRange) {
    if (measuredRange !== undefined) return revealHexes()
    if (!rangeLevelsRef.current || !hexSourcesLoaded()) return
    revealHexes()
  }

  // Both hex sources have everything the current view asks for. Deliberately
  // false while a source is missing: at that point the tiles are still on their
  // way in, and nothing measured over them means anything yet.
  function hexSourcesLoaded() {
    return HEX_SOURCE_IDS.every(
      (id) => map.current.getSource(id) && map.current.isSourceLoaded(id)
    )
  }

  const [boxSelectStartCoords, setBoxSelectStartCoords] = useState()
  const [boxSelectEndCoords, setBoxSelectEndCoords] = useState()

  // The hover chip. Its own class so the frame-stripping in styles.css is
  // scoped to this popup rather than to every MapLibre popup there might ever
  // be. offset lifts it clear of the cursor and of the marker it names.
  const popup = new Popup({
    closeButton: false,
    closeOnClick: true,
    className: 'mapChipPopup',
    offset: 10,
    maxWidth: '260px'
  })

  const colors = ['match', ['get', 'platform']]
  platformColors.reduce((accumulatedPlatformColors, platformColor) => {
    if (platformColor.color) {
      accumulatedPlatformColors.push(platformColor.platform)
      accumulatedPlatformColors.push(platformColor.color)
    }
    return accumulatedPlatformColors
  }, colors)
  colors.push('#000000')

  // --- Focused-dataset dimming -------------------------------------------
  // Singling out one dataset greys every feature that doesn't belong to it.
  // That used to be done by repainting the base layers flat grey and drawing
  // the focused subset back on top through a filtered copy of each layer. Both
  // halves of that are expensive in the same way: setFilter always reports the
  // change as requiring a relayout, and setPaintProperty does too whenever the
  // property is data-driven — which every colour ramp here is (MapLibre returns
  // `isDataDriven || wasDataDriven` regardless of which direction the swap
  // goes). A relayout re-sends every loaded tile of the source to the worker
  // and rebuilds its buckets, so sweeping the dataset list re-tessellated the
  // whole viewport once per row.
  //
  // Instead the grey is a feature-state flag the paint expressions carry from
  // the start. The paint properties are set once at addLayer and never touched
  // for focus, so a focus change is applied GPU-side with no worker round trip.
  // It is the same mechanism griddap-coverage already uses for its hover, and
  // it retires the three '-hovered' layers whose only job was to redraw the
  // focused subset in colour over the greyed base.
  const IS_DIMMED = ['boolean', ['feature-state', 'dimmed'], false]
  const dimmable = (color) => ['case', IS_DIMMED, 'lightgrey', color]

  // setFeatureState addresses a source and source-layer, not a style layer, so
  // this maps the layers a focus can dim onto where their features live.
  const focusTargets = {
    points: { source: 'cde-tiles', sourceLayer: 'internal-layer-name' },
    hexes: { source: 'cde-tiles', sourceLayer: 'internal-layer-name' },
    'coverage-hexes': {
      source: 'cde-cells',
      sourceLayer: 'coverage-hexes-layer'
    }
  }

  // Hex and marker features carry the datasets they aggregate as a JSON array
  // of pks (MapLibre hands nested properties back as strings). Both the dimming
  // and the ramp's domain ask the same question of them.
  const featureHasDataset = (feature, pk) => {
    try {
      return JSON.parse(feature.properties.datasets).includes(pk)
    } catch {
      return false
    }
  }

  // Tracks are the third way a dataset draws itself (hexes, markers, tracks),
  // and they need no feature-state: every track feature carries its dataset on
  // it (pk_url, as a string in the tile), so the paint expression can read the
  // focus straight off the property. See applyTrackFocus.
  const trackIsFocused = (pk) => [
    '==',
    ['to-number', ['get', 'pk_url']],
    pk
  ]

  useEffect(() => {
    setColorStops()
  }, [rangeLevels, coverageRangeLevels])

  useEffect(() => {
    if (boxSelectStartCoords && boxSelectEndCoords) {
      drawPolygon.current?.deleteAll()

      const lineStringObj = helpers.lineString([
        boxSelectStartCoords,
        boxSelectEndCoords
      ])
      const bboxPolygonObj = turfBboxPolygon(turfBbox(lineStringObj))
      setBoxSelectEndCoords()
      setBoxSelectStartCoords()
      setLoading(true)
      drawPolygon.current.add({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [bboxPolygonObj.geometry.coordinates[0]]
        }
      })
      highlightPoints(bboxPolygonObj.geometry.coordinates[0])
      setPolygon(bboxPolygonObj.geometry.coordinates[0])
    }
  }, [boxSelectEndCoords])

  function deleteAllShapes() {
    drawPolygon.current?.deleteAll()
    map.current.setFilter('points-highlighted', ['in', 'pk', ''])
    setPolygon()
  }

  // Cancel whatever draw mode is active and clear the drawn shape — the
  // spatial filter button's "Clear" option, and previously the trash button
  // in the map's lower-right corner.
  function endDrawing() {
    if (!map.current) return
    map.current.getCanvas().style.cursor = 'unset'
    drawPolygon.current.changeMode('simple_select')
    deleteAllShapes()
  }

  // The one hex ramp, shared by the combined 'hexes' layer below z7 and the
  // 'coverage-hexes' layer at and above it. Both read the same 'count'
  // property (the summed metric — see web-api/utils/hexMetric.js), so hex
  // darkness means the same thing at every zoom.
  //
  // The stops are log-spaced by generateColorStops, but the interpolation
  // between them is linear: the non-linearity lives in where the stops sit,
  // not in how MapLibre blends across them.
  //
  // A single-stop ramp (a range of one value, e.g. a filter that leaves one
  // hex) can't be interpolated: fall back to the flat color, since there's
  // nothing to interpolate between.
  const rampExpression = (stops, property) => {
    if (stops.length === 0) return 'lightgrey'
    if (stops.length === 1) return stops[0][1]
    return ['interpolate', ['linear'], ['get', property], ...stops.flat()]
  }

  const hexFillColor = () => rampExpression(colorStops.current, 'count')

  // The `count` property, worded: it is a span of days everywhere on the map
  // (see HEX_METRIC). Numbers are locale-formatted — a bare 1738204 is
  // unreadable at a glance. Note the interpolation variable is `total`, not
  // `count`: i18next treats a numeric `count` option as a pluralization trigger
  // and would go looking for _one/_other variants that don't exist.
  const metricCountLabel = (value) =>
    t('mapHexCountDays', {
      total: Number(value || 0).toLocaleString(i18n.language)
    })

  // Point markers size by the same count the hexes colour by, log-spaced over
  // the point-tier range so the marker for a long mooring record reads bigger
  // than one for a single cast. Log because the range spans orders of
  // magnitude — linear would leave every marker at the minimum but one.
  //
  // `padding` is the halo's extra radius: it sits under the markers and has to
  // grow with them or it stops being a halo.
  //
  // A degenerate range (every point the same count, or the legend not back
  // yet) has nothing to ramp: use the small radius flat.
  const radiusExpression = (range, padding = 0) => {
    const lo = Math.max(range?.[0] ?? 1, 1)
    const hi = range?.[1]
    if (!Number.isFinite(hi) || hi <= lo) return smallCircleSize + padding
    return [
      'interpolate',
      ['linear'],
      ['log10', ['max', ['get', 'count'], 1]],
      Math.log10(lo),
      smallCircleSize + padding,
      Math.log10(hi),
      largeCircleSize + padding
    ]
  }

  // The same ramp evaluated in JS, for the hit-tests that need to know how big
  // a circle actually got drawn. MapLibre clamps an `interpolate` outside its
  // domain to the endpoint value, so this clamps too — otherwise a count past
  // the legend's range would report a radius larger than the one on screen.
  const pointRadiusFor = (count) => {
    const range = pointRadiusRange.current
    const lo = Math.max(range?.[0] ?? 1, 1)
    const hi = range?.[1]
    if (!Number.isFinite(hi) || hi <= lo) return smallCircleSize
    const loLog = Math.log10(lo)
    const hiLog = Math.log10(hi)
    const at = Math.log10(Math.max(Number(count) || 1, 1))
    const ratio = Math.min(Math.max((at - loLog) / (hiLog - loLog), 0), 1)
    return smallCircleSize + ratio * (largeCircleSize - smallCircleSize)
  }

  // The four layers that draw the same point features, and the halo's extra
  // radius. They share one paint, so a radius change has to reach all of them
  // or the halo/highlight desync from the markers they sit under.
  // click-highlight-point rides along so the outline the "what's here" card
  // draws keeps sitting exactly on the marker's edge when the ramp changes.
  const POINT_LAYERS = [
    ['points', 0],
    ['points-halo', 1.25],
    ['points-highlighted', 0],
    ['points-hovered', 0],
    ['click-highlight-point', 0],
    ['click-highlight-point-glow', 6]
  ]
  // Coverage hexes ramp on their own domain (coverageColorStops) rather than
  // the main one: they cover a different population of hexes, and sharing the
  // main tier's min/max flattened them.
  const coverageHexFillColor = () =>
    rampExpression(coverageColorStops.current, 'count')

  // A fixed outline, so a coverage hex still reads as a discrete cell where the
  // fill is nearly transparent (the layer fades out with zoom).
  const coverageHexOutlineColor = () => hexOutlineColor

  // How much of its normal opacity a sparse hex keeps, and how much of the
  // distribution counts as sparse. Refs rather than constants ONLY so the
  // temporary tuning panel below can move them live — see TEMP_FADE_TUNER.
  // Once the values are settled these go back to plain consts and the panel
  // and everything referencing it comes out.
  // Chosen by eye on 2026-08-28. These are what the map actually draws now —
  // the tuner below is hidden unless asked for, so nothing else sets them:
  // gradient fade, opacity climbing from a floor of 0.50 (0.40 against the 0.80
  // base) at a count of 1 up to full strength at the threshold, with the
  // threshold at the 95th percentile of the counts on screen.
  //
  // 0.95 inverts what this started as. It is no longer "dim the emptiest few" —
  // it is "only the busiest few stay at full strength". Unfiltered that leaves
  // 3,270 hexes of 65,586 bright and fades the other 62,316, so the map reads
  // as a handful of hotspots over a wash. Deliberate: at the low end the fade
  // did almost nothing, because 38% of hexes hold exactly one day and any
  // percentile below ~0.4 lands on a threshold of 1.
  const fadeFactorRef = useRef(0.65)
  const fadePercentileRef = useRef(0.95)
  // 'binary'   — one flat faded opacity for everything at or below the
  //              threshold, a hard step at it.
  // 'gradient' — opacity climbs with the count across the faded band and
  //              reaches full strength AT the threshold, so the step is gone.
  // fadeFactorRef is the flat faded value in binary; gradientFloorRef is the
  // floor in gradient. Separate knobs — see gradientFloorRef below.
  const fadeStyleRef = useRef('gradient')
  // The gradient's floor — what a count of 1 gets, as a fraction of the layer's
  // normal opacity. Its own ref rather than sharing fadeFactorRef so the two
  // modes can be dialled independently and compared without one dragging the
  // other. Starts equal to the binary value, so switching style alone changes
  // only the shape of the fade, not how faint its faintest hex is.
  const gradientFloorRef = useRef(0.5)
  // TEMP_FADE_TUNER, ramp half. 'default' = whatever generateColorStops does
  // (log once max/min >= 100, which every real days domain is), so the tuner
  // starts on today's behaviour and any change is a deliberate comparison.
  // rampTopPct caps the ramp's TOP at a percentile of the on-screen counts
  // instead of their maximum — the lever that matters here, because a handful
  // of huge hexes otherwise stretch the domain past everything else.
  const rampModeRef = useRef('default')
  const rampGammaRef = useRef(1)
  const rampTopPctRef = useRef(1)
  const viewportRampTop = useRef(undefined)

  // Is this hex in the sparse band? The count at or below which it counts as
  // sparse comes from the rendered hexes' own distribution (see viewportFadeThreshold).
  //
  // `<=`, not `<`: the counts are small integers at the bottom of the
  // distribution and the threshold is frequently 1, where `<` would fade nothing.
  // Counts are >= 1 and span orders of magnitude, so the gradient ramps over
  // log(count) — the same reason the colour ramp is log. max(...,1) keeps the
  // log defined and pins anything at or below 1 to the floor.
  const LOG_COUNT = ['log10', ['max', ['to-number', ['get', 'count'], 0], 1]]

  // Opacity rising from floor at count 1 to `opacity` at the threshold.
  // interpolate clamps outside its domain, so counts above the threshold get
  // full strength for free. null when the threshold is 1 or less: log10(1) is
  // 0, which would repeat the interpolate's first input and MapLibre rejects a
  // duplicate — callers fall back to the binary form there.
  const gradientFade = (opacity, threshold) => {
    const top = Math.log10(threshold)
    if (!(top > 0)) return null
    return [
      'interpolate',
      ['linear'],
      LOG_COUNT,
      0,
      opacity * gradientFloorRef.current,
      top,
      opacity
    ]
  }

  const isSparseHex = (threshold) => [
    '<=',
    ['to-number', ['get', 'count'], 0],
    threshold
  ]

  // A flat opacity, dimmed for sparse hexes. undefined threshold -> nothing has
  // been measured yet, so nothing fades.
  const fadeFlat = (opacity) => {
    const threshold = viewportFadeThreshold.current
    if (!Number.isFinite(threshold)) return opacity
    if (fadeStyleRef.current === 'gradient') {
      const ramp = gradientFade(opacity, threshold)
      if (ramp) return ramp
    }
    return ['case', isSparseHex(threshold), opacity * fadeFactorRef.current, opacity]
  }

  // The same, for an opacity that already varies with zoom. The 'case' CANNOT
  // wrap the zoom interpolate — MapLibre rejects a 'zoom' expression that is not
  // the input to a top-level step/interpolate, and setPaintProperty throws,
  // which aborts the rest of the paint pass and leaves the hex layers stuck at
  // the opacity 0 they are created with. So the interpolate stays outermost and
  // each of its stop OUTPUTS carries the case instead — the documented
  // zoom-and-data-driven shape.
  const fadeZoomStops = (stops) => {
    const threshold = viewportFadeThreshold.current
    const output = (v) => {
      if (!Number.isFinite(threshold)) return v
      if (fadeStyleRef.current === 'gradient') {
        const ramp = gradientFade(v, threshold)
        if (ramp) return ramp
      }
      return ['case', isSparseHex(threshold), v * fadeFactorRef.current, v]
    }
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      ...stops.flatMap(([zoom, v]) => [zoom, output(v)])
    ]
  }

  // Both hex layers fade on the same measured threshold: measureVisibleHexRange
  // queries them together and only one of them is ever on screen at a time.
  const hexOpacityExpression = () => fadeFlat(hexOpacity)
  const coverageHexOpacityExpression = () =>
    fadeZoomStops(COVERAGE_HEX_OPACITY_STOPS)

  // Push the current fade threshold onto both hex layers. No-op before the
  // opening reveal, which owns fill-opacity until it has run (writing here
  // first would flash the hexes on over the placeholder ramp).
  function applyHexOpacity () {
    if (!hexesRevealed.current || !map.current) return
    if (map.current.getLayer('hexes')) {
      map.current.setPaintProperty(
        'hexes',
        'fill-opacity',
        hexOpacityExpression()
      )
    }
    if (map.current.getLayer('coverage-hexes')) {
      map.current.setPaintProperty(
        'coverage-hexes',
        'fill-opacity',
        coverageHexOpacityExpression()
      )
    }
  }

  // TEMP_FADE_TUNER: stops for the chosen mode/gamma/top-percentile, or null to
  // fall through to generateColorStops. Values must be STRICTLY ascending —
  // MapLibre rejects a repeated interpolate input, and rounding collides
  // readily at the bottom of a log ramp (1, 1, 2, ...) — hence the running max.
  function tunedStops (domain) {
    if (rampModeRef.current === 'default' && rampGammaRef.current === 1 &&
        rampTopPctRef.current === 1) return null
    const lo = Math.max(Number.isFinite(domain && domain[0]) ? domain[0] : 1, 1)
    let hi = domain && domain[1]
    if (rampTopPctRef.current < 1 && Number.isFinite(viewportRampTop.current)) {
      hi = viewportRampTop.current
    }
    if (!Number.isFinite(hi) || hi <= lo) return null
    const linear = rampModeRef.current === 'linear'
    const gamma = rampGammaRef.current
    const n = colorScale.length
    const out = []
    let prev = -Infinity
    for (let i = 0; i < n; i++) {
      const t = Math.pow(n === 1 ? 0.5 : i / (n - 1), gamma)
      const raw = linear ? lo + (hi - lo) * t : lo * Math.pow(hi / lo, t)
      const v = Math.max(Math.round(raw), prev + 1)
      prev = v
      out.push([v, colorScale[i]])
    }
    return out
  }

  // The percentile of an unsorted numeric array, by nearest rank. Returns
  // undefined for an empty one so callers can tell "no data" from "zero".
  function percentileOf (values, fraction) {
    if (!values || values.length === 0) return undefined
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(fraction * sorted.length) - 1)
    )
    return sorted[index]
  }

  function setColorStops() {
    // The map now mounts before the legend request resolves (first paint is
    // no longer gated on it), so rangeLevels can be undefined on early calls.
    // getCurrentRangeLevel/generateColorStops both throw on undefined, so bail
    // until the ranges arrive — the [rangeLevels] effect re-runs this then.
    if (!map.current) return
    // Fall back to the placeholder ranges until the legend resolves, so the
    // count-driven layers are always created and painted with valid stops
    // (see defaultRangeLevels). The real ranges replace these once /legend
    // returns and this re-runs via the [rangeLevels] effect.
    const effectiveRangeLevels = rangeLevels || defaultRangeLevels
    // The measured extent of the hexes on screen wins over the tier's global
    // domain when there is one — see refreshViewportHexRange. Zoomed into a
    // quiet corner, the global maximum is set by a hex somewhere else entirely,
    // and every cell in view lands in the bottom decade of the ramp: one flat
    // pale shade over the whole viewport. The same measurement serves both
    // layers below, because only one of them is ever on screen (the combined
    // hexes below the marker tier, the coverage cells at and above it).
    const hexDomain =
      viewportHexRange.current ||
      getCurrentRangeLevel(effectiveRangeLevels, map.current.getZoom())
    colorStops.current =
      tunedStops(hexDomain) ||
      generateColorStops(colorScale, hexDomain).map((colorStop) => {
        return [colorStop.stop, colorStop.color]
      })

    // Coverage hexes only ever render at zoom >= hexMaxZoom, where the hex_1
    // grid is always used, so there's a single range to apply.
    const effectiveCoverageRangeLevels =
      coverageRangeLevels || defaultCoverageRangeLevels
    const coverageDomain =
      viewportHexRange.current || effectiveCoverageRangeLevels.zoom1
    coverageColorStops.current =
      tunedStops(coverageDomain) ||
      generateColorStops(colorScale, coverageDomain).map((colorStop) => {
        return [colorStop.stop, colorStop.color]
      })

    // Point radius now has to be a ramp too. It used to be a hardcoded
    // `count <= 2 ? small : large` split, which meant "one day of data or
    // more than one" — a threshold that says nothing once count is a
    // measurement count in the millions (every point would be large).
    pointRadiusRange.current = getCurrentRangeLevel(
      effectiveRangeLevels,
      hexMaxZoom
    )

    // The ramps and the focus used to fight each other: this runs on zoomend
    // and on every legend refetch, so repainting the ramp here un-greyed a
    // focused map the moment the camera settled, and the fix was to bail out
    // early and re-apply the focus instead. Neither is needed now — the grey is
    // a feature-state branch inside the ramp expressions (see dimmable), so a
    // ramp refresh carries the focus through untouched.
    if (colorStops.current.length > 0) {
      if (map.current.getZoom() >= 7 && map.current.getLayer('points')) {
        map.current.setPaintProperty('points', 'circle-color', dimmable(colors))
      }
      // Always keep the hexes layer's stops populated, not just when zoomed
      // into the hex band — a reload while zoomed in (zoom >= 7) would
      // otherwise leave it unpainted so hexes never appear on zoom-out. It's
      // hidden above z7 anyway, and zoomend re-runs this to refine the z0/z1
      // band.
      if (map.current.getLayer('hexes')) {
        map.current.setPaintProperty(
          'hexes',
          'fill-color',
          dimmable(hexFillColor())
        )
        // Update opacity based on the new fade threshold
        map.current.setPaintProperty(
          'hexes',
          'fill-opacity',
          hexOpacityExpression()
        )
      }
    }

    // The circle-radius ramp tracks the same metric as the fill, so it has to
    // be re-applied whenever the ranges change — on all four point layers,
    // which share one paint.
    POINT_LAYERS.forEach(([layer, padding]) => {
      if (map.current.getLayer(layer)) {
        map.current.setPaintProperty(
          layer,
          'circle-radius',
          radiusExpression(pointRadiusRange.current, padding)
        )
      }
    })

    if (map.current.getLayer('coverage-hexes')) {
      map.current.setPaintProperty(
        'coverage-hexes',
        'fill-color',
        dimmable(coverageHexFillColor())
      )
      map.current.setPaintProperty(
        'coverage-hexes',
        'fill-outline-color',
        coverageHexOutlineColor()
      )
      // Update opacity based on the new fade threshold
      map.current.setPaintProperty(
        'coverage-hexes',
        'fill-opacity',
        coverageHexOpacityExpression()
      )
    }
  }
  setColorStopsRef.current = setColorStops

  // Whether queryRenderedFeatures can still answer "what is on screen". It
  // builds the region it searches by unprojecting the viewport corners, and in
  // globe projection a corner whose ray misses the sphere is snapped to the
  // nearest point on the horizon instead (unprojectScreenPoint in maplibre-gl,
  // whose own query code calls globe support a hack pending a real
  // implementation). The region searched is then not the region on screen, so
  // the measurement it feeds is fiction — and the crossover is abrupt: the
  // corners leave the sphere the moment the globe stops covering them, at about
  // z3 on a wide window and lower on a tall one, which is exactly where the
  // ramp domain was seen to jump and re-shade the whole map on a zoom-out.
  //
  // An unproject/project round trip is the test, and a cheap one — two matrix
  // multiplies per corner. It only fails for a screen point that is not on the
  // map surface, so mercator never trips it (nor does globe once the globe
  // fills the view).
  function viewportQueryIsReliable() {
    const canvas = map.current.getCanvas()
    const corners = [
      [0, 0],
      [canvas.clientWidth, 0],
      [0, canvas.clientHeight],
      [canvas.clientWidth, canvas.clientHeight]
    ]
    return corners.every(([x, y]) => {
      const roundTrip = map.current.project(map.current.unproject([x, y]))
      return (
        Math.hypot(roundTrip.x - x, roundTrip.y - y) <=
        SURFACE_ROUND_TRIP_TOLERANCE_PX
      )
    })
  }

  // The count range the hexes on screen span, snapped out to the nearest nice
  // rungs, or undefined when there is nothing to measure. Read from what is
  // rendered rather than fetched: the counts are already on the features the
  // map is drawing, so a viewport-scaled ramp costs no request — one pass over
  // the visible hexes, which is at most a few thousand small objects.
  function measureVisibleHexRange(focusPk) {
    // Cleared up front so every path that gives up below leaves no stale
    // threshold behind: a fade band measured over the last view would otherwise
    // keep being applied to hexes it was never measured against.
    viewportFadeThreshold.current = undefined
    const layers = HEX_LAYER_IDS.filter((id) => map.current.getLayer(id))
    if (!layers.length) return undefined
    // No trustworthy answer to be had — see viewportQueryIsReliable. Nothing is
    // lost by not measuring here: this only happens with the whole globe in
    // view, where the catalogue-wide tier range the ramp falls back to is the
    // honest domain anyway, and it holds still under pan, rotate and zoom
    // instead of shifting with a query region that has nothing to do with the
    // view.
    if (!viewportQueryIsReliable()) return undefined
    // No geometry argument = the whole viewport. Hidden layers and layers
    // outside their zoom range return nothing, so this needs no zoom or
    // visibility test of its own.
    const features = map.current.queryRenderedFeatures({ layers })
    if (features.length < MIN_VIEWPORT_HEXES) return undefined
    let lo = Infinity
    let hi = -Infinity
    // Counts kept for the quartile below. One array and one sort per settled
    // camera — the thing the loop avoids is a map/filter CHAIN allocating an
    // intermediate per stage, not a single collection. Deduped by feature id
    // (promoteId lifts the hex pk onto it) because a hex straddling a tile
    // boundary is returned once per tile: harmless for the min/max, but it
    // would weight those hexes twice in a percentile.
    const counts = []
    const seen = new Set()
    // A plain loop, not a map/filter chain: this runs over every rendered hex,
    // and the intermediate arrays are the only part of it that would be
    // expensive. Features straddling a tile boundary appear more than once —
    // harmless for a min/max.
    for (const feature of features) {
      // With a dataset page open, every other dataset's cells are greyed (see
      // hoverHighlightPoints) — they carry none of the ramp's colours, so they
      // have no business setting its domain. Measuring them was what made the
      // few coloured cells change shade on a pan across unrelated data.
      if (focusPk !== undefined && !featureHasDataset(feature, focusPk)) continue
      const count = Number(feature.properties?.count)
      if (!Number.isFinite(count) || count <= 0) continue
      if (count < lo) lo = count
      if (count > hi) hi = count
      const id = feature.id
      if (id !== undefined) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      counts.push(count)
    }
    if (!Number.isFinite(hi)) return undefined
    viewportFadeThreshold.current = percentileOf(counts, fadePercentileRef.current)
    viewportRampTop.current = percentileOf(counts, rampTopPctRef.current)
    return quantizeCountRange([lo, hi])
  }

  // Re-scale the ramp to what is on screen. Called on a debounce from the
  // camera and tile events, and cheap to call spuriously: quantizing the
  // measurement to coarse rungs (see quantizeCountRange) means an ordinary pan
  // measures the same domain it started from, and an unchanged domain returns
  // here without touching the map or the legend. That dedupe is also what stops
  // the loop — repainting a data-driven paint property makes the map re-render,
  // which is one of the things that calls this.
  function refreshViewportHexRange() {
    if (!map.current || !map.current.isStyleLoaded()) return
    // Nothing has moved and no tile has landed since the last measurement, so
    // the answer is the one already on hand. Worth the flag: 'idle' also
    // arrives after the re-renders a hover causes, and a viewport full of
    // hexes is not free to walk.
    if (!hexRangeDirty.current) return
    const focusPk = rampFocusPk.current
    // An open dataset page measures once and then holds. The ramp is scaled to
    // that dataset's cells, and those cells are being read against each other —
    // re-scaling under every drag would paint the same cell a different shade
    // each time the camera settled, which is exactly what the ramp is for
    // avoiding. Panning has nothing to re-measure until the page closes or a
    // filter changes what the counts mean (resetViewportHexRange).
    if (focusPk !== undefined && rampMeasuredForPk.current === focusPk) return
    hexRangeDirty.current = false
    const range = measureVisibleHexRange(focusPk)
    // Only a real measurement locks it: opening a page while its dataset is off
    // screen finds nothing, and should keep looking until the camera reaches it.
    if (focusPk !== undefined && range !== undefined) {
      rampMeasuredForPk.current = focusPk
    }
    // The fade threshold has just been re-measured, and it can move while the
    // QUANTIZED range holds still (coarse rungs, see quantizeCountRange) — so it
    // is applied here rather than only on the setColorStops path below, which
    // the equal-ranges branch returns before reaching. Safe against the repaint
    // -> re-render -> re-measure loop: hexRangeDirty is already false above, so
    // the call this repaint provokes returns at the top.
    applyHexOpacity()
    if (rangesEqual(viewportHexRange.current, range)) {
      // Nothing to repaint — but the pass still says the ramp already on the
      // layers is the one this view gets, which is what the first reveal waits
      // for. (The common way in on a first load: the measurement runs before
      // any hexes have arrived, finds none, and the legend's tier stands.)
      revealHexesIfRamped(range)
      return
    }
    viewportHexRange.current = range
    setColorStopsRef.current()
    onViewportHexRangeRef.current(range)
    revealHexesIfRamped(range)
  }

  // ===========================================================================
  // TEMP_FADE_TUNER — throwaway control for dialling in the sparse-hex fade.
  // Delete this whole block (and put fadeFactorRef / fadePercentileRef back to
  // plain consts) once the numbers are chosen. Deliberately plain DOM rather
  // than React: it has to be trivially deletable and must not touch the
  // component tree or any real state.
  // ===========================================================================
  useEffect(() => {
    // Hidden unless asked for: `?tuner=1` in the address bar turns it on,
    // `?tuner=0` turns it back off.
    //
    // The flag has to be latched rather than read from the URL each render,
    // because useUrlSync rebuilds the query string from a fixed whitelist and
    // navigates with replace on every map move — an unknown param survives only
    // until the first pan. sessionStorage keeps it for the tab instead, so the
    // panel also survives the reload after a rebuild. Wrapped because storage
    // throws outright in some contexts (private windows, blocked site data).
    const TUNER_KEY = 'cde:fadeTuner'
    let enabled = false
    try {
      const asked = new URLSearchParams(window.location.search).get('tuner')
      if (asked !== null) {
        enabled = asked !== '0' && asked !== 'false'
        sessionStorage.setItem(TUNER_KEY, enabled ? '1' : '0')
      } else {
        enabled = sessionStorage.getItem(TUNER_KEY) === '1'
      }
    } catch {
      const asked = new URLSearchParams(window.location.search).get('tuner')
      enabled = asked !== null && asked !== '0' && asked !== 'false'
    }
    if (!enabled) return

    const host = document.createElement('div')
    host.id = 'temp-fade-tuner'
    host.style.cssText = [
      'position:fixed', 'bottom:110px', 'right:12px', 'z-index:9999',
      'max-height:70vh', 'overflow:auto',
      'background:rgba(255,255,255,0.96)', 'border:1px solid #b9c9c5',
      'border-radius:8px', 'padding:10px 12px', 'width:250px',
      'font:12px/1.45 system-ui,sans-serif', 'color:#123',
      'box-shadow:0 2px 10px rgba(0,0,0,0.18)'
    ].join(';')
    host.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">Hex fade (temporary)</div>
      <label style="display:block">Style
        <select id="tft-style" style="width:100%;font-size:11px;margin-top:2px">
          <option value="binary">binary (hard step)</option>
          <option value="gradient">gradient (ramps with count)</option>
        </select>
      </label>
      <label id="tft-row-binary" style="display:block;margin-top:6px">
        Faded opacity &times; <b id="tft-f-val">0.65</b>
        <input id="tft-f" type="range" min="0.05" max="1" step="0.05" value="0.65"
               style="width:100%">
      </label>
      <label id="tft-row-gradient" style="display:block;margin-top:6px">
        Gradient floor &times; <b id="tft-floor-val">0.50</b>
        <input id="tft-floor" type="range" min="0.05" max="1" step="0.05" value="0.5"
               style="width:100%">
      </label>
      <label style="display:block;margin-top:6px">Sparse cutoff pctile
        <b id="tft-p-val">0.95</b>
        <input id="tft-p" type="range" min="0" max="1" step="0.01" value="0.95"
               style="width:100%">
      </label>
      <div id="tft-out" style="margin-top:8px;font-size:11px;color:#456"></div>
      <div style="border-top:1px solid #ccd;margin:10px 0 8px"></div>
      <div style="font-weight:600;margin-bottom:6px">Colour ramp</div>
      <label style="display:block">Spacing
        <select id="tft-mode" style="width:100%;font-size:11px;margin-top:2px">
          <option value="default">default (log here)</option>
          <option value="log">log (forced)</option>
          <option value="linear">linear</option>
        </select>
      </label>
      <label style="display:block;margin-top:6px">Top percentile
        <b id="tft-top-val">1.00</b>
        <input id="tft-top" type="range" min="0.80" max="1" step="0.01" value="1"
               style="width:100%">
      </label>
      <label style="display:block;margin-top:6px">Gamma
        <b id="tft-g-val">1.00</b>
        <input id="tft-g" type="range" min="0.3" max="3" step="0.1" value="1"
               style="width:100%">
      </label>
      <div id="tft-ramp" style="margin-top:6px;font-size:10px;color:#456;
           word-break:break-all"></div>
      <button id="tft-reset" style="margin-top:8px;width:100%;font-size:11px;
              padding:3px;cursor:pointer">reset</button>`
    document.body.appendChild(host)

    const $ = (id) => host.querySelector(id)
    // The counts on screen, deduped by feature id exactly as
    // measureVisibleHexRange does, so the tuner's threshold matches the real one.
    const visibleCounts = () => {
      if (!map.current) return { layer: null, counts: [] }
      const layer = ['hexes', 'coverage-hexes'].find(
        (id) => map.current.getLayer(id) && map.current.queryRenderedFeatures({ layers: [id] }).length
      )
      if (!layer) return { layer: null, counts: [] }
      const counts = []
      const seen = new Set()
      for (const f of map.current.queryRenderedFeatures({ layers: [layer] })) {
        const c = Number(f.properties?.count)
        if (!Number.isFinite(c) || c <= 0) continue
        if (f.id !== undefined) {
          if (seen.has(f.id)) continue
          seen.add(f.id)
        }
        counts.push(c)
      }
      return { layer, counts }
    }
    const readout = () => {
      const { layer, counts } = visibleCounts()
      const threshold = viewportFadeThreshold.current
      const faded = Number.isFinite(threshold)
        ? counts.filter((c) => c <= threshold).length
        : 0
      const style = fadeStyleRef.current
      $('#tft-out').textContent = counts.length
        ? `${layer} [${style}]: threshold ${threshold} - ${faded}/${counts.length} ` +
          `${style === 'gradient' ? 'ramped' : 'faded'} (${(100 * faded / counts.length).toFixed(0)}%)`
        : 'no hexes on screen'
      // What the ramp is actually doing: its stops, and how many hexes land in
      // each band. Even buckets mean the palette is being spent on the data.
      const stops = colorStops.current || []
      if (stops.length && counts.length) {
        const per = stops.map((st, i) => {
          const from = i ? stops[i - 1][0] : 0
          return counts.filter((c) => c > from && c <= st[0]).length
        })
        const over = counts.filter((c) => c > stops[stops.length - 1][0]).length
        $('#tft-ramp').textContent =
          `stops ${stops.map((st) => st[0]).join(' ')}\nper band ${per.join(' ')}` +
          (over ? ` (+${over} above top)` : '')
      } else {
        $('#tft-ramp').textContent = ''
      }
    }
    // Recompute the threshold HERE rather than going through
    // refreshViewportHexRange: that bails early when the style is mid-load or
    // the quantized range is unchanged, which left the percentile slider inert.
    const apply = () => {
      const { counts } = visibleCounts()
      if (counts.length) {
        viewportFadeThreshold.current = percentileOf(counts, fadePercentileRef.current)
      }
      setColorStops()
      applyHexOpacity()
      readout()
    }
    // Only one of the two opacity rows applies at a time; dim the other so the
    // panel says which knob is live rather than leaving both looking active.
    const syncRows = () => {
      const gradient = fadeStyleRef.current === 'gradient'
      $('#tft-row-binary').style.opacity = gradient ? '0.4' : '1'
      $('#tft-row-gradient').style.opacity = gradient ? '1' : '0.4'
    }
    $('#tft-style').value = fadeStyleRef.current
    syncRows()
    $('#tft-style').addEventListener('change', (e) => {
      fadeStyleRef.current = e.target.value
      syncRows()
      applyHexOpacity()
      readout()
    })
    $('#tft-floor').addEventListener('input', (e) => {
      gradientFloorRef.current = Number(e.target.value)
      $('#tft-floor-val').textContent = Number(e.target.value).toFixed(2)
      applyHexOpacity()
      readout()
    })
    $('#tft-mode').addEventListener('change', (e) => {
      rampModeRef.current = e.target.value
      apply()
    })
    $('#tft-top').addEventListener('input', (e) => {
      rampTopPctRef.current = Number(e.target.value)
      $('#tft-top-val').textContent = Number(e.target.value).toFixed(2)
      // the cap is a percentile of the on-screen counts, so re-measure first
      const { counts } = visibleCounts()
      if (counts.length) {
        viewportRampTop.current = percentileOf(counts, rampTopPctRef.current)
      }
      apply()
    })
    $('#tft-g').addEventListener('input', (e) => {
      rampGammaRef.current = Number(e.target.value)
      $('#tft-g-val').textContent = Number(e.target.value).toFixed(2)
      apply()
    })
    $('#tft-f').addEventListener('input', (e) => {
      fadeFactorRef.current = Number(e.target.value)
      $('#tft-f-val').textContent = e.target.value
      applyHexOpacity()
      readout()
    })
    $('#tft-p').addEventListener('input', (e) => {
      fadePercentileRef.current = Number(e.target.value)
      $('#tft-p-val').textContent = Number(e.target.value).toFixed(2)
      apply()
    })
    $('#tft-reset').addEventListener('click', () => {
      fadeFactorRef.current = 0.65
      fadePercentileRef.current = 0.95
      fadeStyleRef.current = 'gradient'
      gradientFloorRef.current = 0.5
      $('#tft-style').value = 'gradient'
      $('#tft-floor').value = '0.5'
      $('#tft-floor-val').textContent = '0.50'
      syncRows()
      rampModeRef.current = 'default'
      rampGammaRef.current = 1
      rampTopPctRef.current = 1
      $('#tft-f').value = '0.65'
      $('#tft-p').value = '0.95'
      $('#tft-mode').value = 'default'
      $('#tft-top').value = '1'
      $('#tft-g').value = '1'
      $('#tft-f-val').textContent = '0.65'
      $('#tft-p-val').textContent = '0.95'
      $('#tft-top-val').textContent = '1.00'
      $('#tft-g-val').textContent = '1.00'
      apply()
    })
    const poll = setInterval(readout, 1200)
    return () => {
      clearInterval(poll)
      host.remove()
    }
  }, [])

  // Drop the measurement and fall back to the global tier. For the changes that
  // make the counts on screen mean something else — new filters, a new geometry
  // selection — where the hexes about to be drawn have nothing to do with the
  // ones just measured. The next idle re-measures, once the new tiles are up.
  function resetViewportHexRange() {
    hexRangeDirty.current = true
    rampMeasuredForPk.current = undefined
    if (viewportHexRange.current === undefined) return
    viewportHexRange.current = undefined
    setColorStopsRef.current?.()
    onViewportHexRangeRef.current(undefined)
  }

  // The track layers' half of the focus. Unlike the hex/marker layers this is
  // paint on the whole layer rather than per-feature state, so it survives new
  // tiles on its own and only has to be re-applied when the focus itself
  // changes — the signature guard below keeps the calls from the map's own
  // 'idle' free.
  //
  // A selected platform outranks a focused dataset: its own track is drawn on
  // top by the 'selected-track' layers, and everything under it goes flat grey
  // so it reads alone. Without a selection, the focused dataset's tracks keep
  // their colour and every other dataset's go grey.
  function applyTrackFocus() {
    if (!map.current || !map.current.getLayer('track-lines')) return
    const pk = selectedTrajectoryRef.current
      ? 'selection'
      : focusedDatasetPk.current
    if (trackFocusApplied.current === pk) return
    trackFocusApplied.current = pk

    const [lineColor, headIcon] =
      pk === 'selection'
        ? ['lightgrey', 'track-head-arrow-dim']
        : pk
          ? [
            ['case', trackIsFocused(pk), trackLineColor, 'lightgrey'],
            ['case', trackIsFocused(pk), 'track-head-arrow', 'track-head-arrow-dim']
          ]
          : [trackLineColor, 'track-head-arrow']

    map.current.setPaintProperty('track-lines', 'line-color', lineColor)
    map.current.setLayoutProperty('track-heads', 'icon-image', headIcon)
    map.current.setPaintProperty('track-heads-fixed', 'circle-color', lineColor)
  }

  function hoverHighlightPoints(pk) {
    if (!map.current || !layersLoaded.current) return
    applyTrackFocus()

    // Which rendered features do NOT belong to the focused dataset — those are
    // the ones that go grey. queryRenderedFeatures only sees what is on screen
    // now, which is why this has to be re-run every time new tiles land (see
    // the sourcedata handler). Below z7 a dataset's profiles are merged into
    // the green 'hexes' aggregate; above it they are individual points.
    const pointLevel = map.current.getZoom() >= 7
    const dimmedLayers = [pointLevel ? 'points' : 'hexes', 'coverage-hexes']

    const dimmed = {}
    dimmedLayers.forEach((layerId) => {
      if (!pk || !map.current.getLayer(layerId)) {
        dimmed[layerId] = []
        return
      }
      dimmed[layerId] = map.current
        .queryRenderedFeatures({ layers: [layerId] })
        .filter((feature) => !featureHasDataset(feature, pk))
        // promoteId puts pk on the feature id, which is what setFeatureState
        // addresses.
        .map((feature) => feature.id)
    })

    // Writing the state makes the map fire the very events that re-run this
    // (sourcedata, idle), so a no-op has to stay a no-op or the map spins in a
    // render loop. The zoom band is part of the signature because it decides
    // which layer is dimmed.
    const signature = [
      pk,
      pointLevel,
      ...dimmedLayers.map((layerId) => dimmed[layerId].join(','))
    ].join('|')
    if (signature === appliedFocus.current) return
    appliedFocus.current = signature

    // Cleared wholesale rather than by tracking what was set last time: two
    // calls, and they cannot drift out of step with the map. Both source layers
    // are cleared every time, so the aggregate that isn't dimmed at this zoom
    // can't keep stale state from the other side of the z7 hand-off. ('points'
    // and 'hexes' share a source layer, so clearing one clears both.)
    map.current.removeFeatureState(focusTargets.points)
    map.current.removeFeatureState(focusTargets['coverage-hexes'])

    dimmedLayers.forEach((layerId) =>
      dimmed[layerId].forEach((id) =>
        map.current.setFeatureState(
          { ...focusTargets[layerId], id },
          { dimmed: true }
        )
      )
    )
  }

  const emptyFeatureCollection = { type: 'FeatureCollection', features: [] }

  // Latest coverage prop, readable from the map 'load' closure (which would
  // otherwise capture the initial render's value).
  const griddapCoverageRef = useRef(null)
  const wmsMoveHandler = useRef(null)
  // Bumped whenever the overlay is (re)configured or removed so stale
  // in-flight GetMap image loads are dropped instead of drawn.
  const wmsRenderToken = useRef(0)
  // Latest spatial filter, readable from the debounced moveend handler (which
  // would otherwise capture the polygon as of the overlay's last render).
  const polygonRef = useRef(null)

  // Single-dataset griddap footprint (hover from the list, or pinned while
  // its WMS overlay is shown).
  function setGriddapHighlight(geometry) {
    const source = map.current?.getSource('griddap-highlight')
    if (!source) return
    source.setData(
      geometry
        ? { type: 'Feature', geometry, properties: {} }
        : emptyFeatureCollection
    )
  }

  // Outline the region the open card describes, and clear it when the card
  // closes. Guarded on the source existing: a share link can resolve a click
  // payload before the style has finished adding layers.
  useEffect(() => {
    const source = map.current?.getSource('click-highlight')
    if (!source) return
    source.setData(featureQuery?.highlight || emptyFeatureCollection)
  }, [featureQuery])

  // Coverage rectangles under the cursor, deduped by dataset: a stack of
  // gridded datasets covering the same water is the norm, not the exception.
  const hoveredGriddapIds = useRef([])

  function dedupeGriddapByPk(features) {
    const byPk = new Map()
    features.forEach((feature) => {
      if (!byPk.has(feature.properties.pk)) byPk.set(feature.properties.pk, feature)
    })
    return [...byPk.values()]
  }

  function setGriddapHovered(features) {
    if (!map.current?.getSource('griddap-coverage')) return
    const setHovered = (id, hovered) =>
      map.current.setFeatureState(
        { source: 'griddap-coverage', id },
        { hovered }
      )
    hoveredGriddapIds.current.forEach((id) => setHovered(id, false))
    hoveredGriddapIds.current = features.map((feature) => feature.id)
    hoveredGriddapIds.current.forEach((id) => setHovered(id, true))
  }

  // nested feature properties arrive JSON-stringified from MapLibre
  function griddapTitle(feature) {
    try {
      const titleTranslated = JSON.parse(feature.properties.title_translated)
      return (
        titleTranslated[i18n.language] ||
        titleTranslated.en ||
        feature.properties.dataset_id
      )
    } catch (error) {
      return feature.properties.dataset_id || ''
    }
  }

  // While a WMS overlay is active every other data layer is hidden so the
  // gridded field reads cleanly; only the basemap, the raster and the
  // dataset's bbox outline stay visible. The observation layers (hexes,
  // points, coverage cells) are listed separately from the griddap coverage
  // layers because the layer picker can hide them independently.
  const observationLayerIds = [
    'hexes',
    'points',
    'points-halo',
    'points-highlighted',
    'coverage-hexes'
  ]
  // The track layers are deliberately NOT in observationLayerIds: the picker
  // switch reads as "hexes and points", and it used to hide the tracks too, so
  // unchecking it silently threw away the user's track lines. They are owned by
  // the trajectories layer and its track-lines switch instead
  // (applyLayerVisibility) — this list exists only for the WMS overlay, which
  // hides everything regardless of who owns it.
  const trackLayerIds = [
    'track-lines',
    'track-heads',
    'track-heads-fixed',
    'selected-track-line',
    'selected-track-fixes',
    'selected-track-fixes-nocog'
  ]
  const griddapLayerIds = ['griddap-coverage-fill', 'griddap-coverage-line']
  // The CHS NONNA depth rasters the legend's depth ramp keys. They belong to
  // the basemap, not to the data, so they are owned by their own switch and are
  // left out of every group above — including the WMS overlay's blanket hide,
  // which is about data layers competing with the gridded field.
  const bathymetryLayerIds = ['bathymetry-nonna-100', 'bathymetry-nonna-10']
  // Mirrors the dataLayersVisible prop so removeWmsOverlay (called from map
  // event handlers) restores the user's toggle instead of forcing layers on.
  const dataLayersVisibleRef = useRef(true)
  // Same, for the depth rasters: the style's layers are created visible, so the
  // 'load' handler needs the current switch state to apply it.
  const bathymetryVisibleRef = useRef(true)

  function setLayersVisibility(layerIds, visible) {
    layerIds.forEach((layerId) => {
      if (map.current.getLayer(layerId)) {
        map.current.setLayoutProperty(
          layerId,
          'visibility',
          visible ? 'visible' : 'none'
        )
      }
    })
    // Showing a layer changes what a measurement would find — a hidden layer
    // returns nothing from queryRenderedFeatures — so the ramp has to be
    // re-measured, and until it is, the hexes are still waiting to be revealed
    // (see revealHexes). Nothing else raises this flag for a visibility change:
    // no tile lands and the camera does not move, so only the 'idle' that
    // follows the repaint is left to act on it.
    if (visible) hexRangeDirty.current = true
  }

  // WMS overlay show/hide. Hiding takes everything with it, including the
  // tracks; restoring hands each group back to its own owner — the picker for
  // the hex/point layers, applyLayerVisibility for the tracks.
  function setDataLayersVisibility(visible) {
    setLayersVisibility(griddapLayerIds, visible)
    if (!visible) {
      setLayersVisibility(observationLayerIds, false)
      setLayersVisibility(trackLayerIds, false)
      return
    }
    setLayersVisibility(observationLayerIds, dataLayersVisibleRef.current)
    setLayersVisibility(trackLayerIds, true)
    applyLayerVisibility()
  }

  function removeWmsOverlay() {
    wmsRenderToken.current += 1
    if (wmsMoveHandler.current) {
      map.current.off('moveend', wmsMoveHandler.current)
      wmsMoveHandler.current = null
    }
    if (map.current.getLayer('wms-overlay')) {
      map.current.removeLayer('wms-overlay')
    }
    if (map.current.getSource('wms-overlay')) {
      map.current.removeSource('wms-overlay')
    }
    setDataLayersVisibility(true)
  }

  // One WMS GetMap for the current viewport: ERDDAP's WMS is EPSG:4326-only,
  // so the response is requested with extra vertical resolution and warped to
  // Mercator before it's handed to the image source (see wmsUtilities).
  // A spatial filter narrows the overlay to the selection: the raster is only
  // requested and drawn over the filter's bounding box, so what's on the map
  // is the subset of the grid the filter actually selects. Read through a ref
  // so the debounced moveend handler always clips with the current polygon.
  function renderWmsImage(overlay) {
    if (!map.current) return
    const viewportBounds = clampBoundsForWms(map.current.getBounds())
    if (
      viewportBounds.south >= viewportBounds.north ||
      viewportBounds.west >= viewportBounds.east
    ) {
      return
    }
    const bounds = intersectBoundsWithPolygonBbox(
      viewportBounds,
      polygonRef.current
    )
    // filter selection is entirely off-screen: nothing to draw
    if (!bounds) {
      const emptySource = map.current.getSource('wms-overlay')
      if (emptySource && map.current.getLayer('wms-overlay')) {
        map.current.setLayoutProperty('wms-overlay', 'visibility', 'none')
      }
      return
    }
    if (map.current.getLayer('wms-overlay')) {
      map.current.setLayoutProperty('wms-overlay', 'visibility', 'visible')
    }
    const canvasElement = map.current.getCanvas()
    const outWidth = Math.min(canvasElement.clientWidth, 2048)
    const outHeight = Math.min(canvasElement.clientHeight, 2048)
    const url = buildWmsGetMapUrl({
      wmsUrl: overlay.wmsUrl,
      datasetId: overlay.datasetId,
      variable: overlay.variable.name,
      bounds,
      width: outWidth,
      height: Math.min(Math.round(outHeight * 1.75), 2048),
      time: overlay.time,
      elevation: overlay.elevation
    })
    const token = wmsRenderToken.current
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (token !== wmsRenderToken.current || !map.current) return
      let imageUrl
      try {
        imageUrl = warpEquirectToMercator(
          img,
          bounds.south,
          bounds.north,
          outWidth,
          outHeight
        ).toDataURL('image/png')
      } catch (error) {
        // canvas tainted (server without CORS headers) — show unwarped
        console.warn('WMS warp failed, using unwarped image', error)
        imageUrl = url
      }
      const coordinates = [
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.east, bounds.south],
        [bounds.west, bounds.south]
      ]
      const source = map.current.getSource('wms-overlay')
      if (source) {
        source.updateImage({ url: imageUrl, coordinates })
      } else {
        map.current.addSource('wms-overlay', {
          type: 'image',
          url: imageUrl,
          coordinates
        })
        // Inserted under the bottom-most data layer: basemap below, every
        // hex/point/coverage layer above the raster.
        map.current.addLayer(
          {
            id: 'wms-overlay',
            type: 'raster',
            source: 'wms-overlay',
            paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 }
          },
          map.current.getLayer('coverage-hexes') ? 'coverage-hexes' : undefined
        )
      }
    }
    img.onerror = () => console.warn(`WMS GetMap failed: ${url}`)
    img.src = url
  }

  // The single dataset the map singles out: whatever the cursor is over in the
  // list, else the dataset whose page is open. Inspecting a dataset therefore
  // pins the same highlight hovering gives, until it's closed. Every other
  // dataset stays on the map, drawn grey — they are still the context this one
  // is being read against.
  useEffect(() => {
    if (map.current) {
      const focusedDataset = hoveredDataset || inspectDataset
      // The ramp follows the open page only, never the hover: rescaling it per
      // row would set the whole map moving as the cursor swept the list. A new
      // page (or none) means the held measurement no longer describes what is
      // coloured, so the next idle takes a fresh one.
      const rampPk =
        inspectDataset && inspectDataset.cdm_data_type !== 'Grid'
          ? inspectDataset.pk
          : undefined
      if (rampPk !== rampFocusPk.current) {
        rampFocusPk.current = rampPk
        rampMeasuredForPk.current = undefined
        hexRangeDirty.current = true
      }
      if (focusedDataset?.cdm_data_type === 'Grid') {
        // A griddap dataset has no map features: highlighting its pk would
        // grey the whole map with nothing selected. Draw its bbox instead.
        focusedDatasetPk.current = undefined
        hoverHighlightPoints()
        setGriddapHighlight(focusedDataset.coverage_bbox_geojson)
      } else {
        focusedDatasetPk.current = focusedDataset?.pk
        setGriddapHighlight(activeWmsOverlay ? activeWmsOverlay.bbox : null)
        hoverHighlightPoints(focusedDataset?.pk)
      }
      // Also from here: hoverHighlightPoints skips everything until the layers
      // have settled, and clearing a focus has no later event to ride in on.
      applyTrackFocus()
    }
  }, [hoveredDataset, inspectDataset, activeWmsOverlay])

  useEffect(() => {
    griddapCoverageRef.current = griddapCoverage
    const source = map.current?.getSource('griddap-coverage')
    if (source) source.setData(griddapCoverage || emptyFeatureCollection)
  }, [griddapCoverage])

  // Layer-picker toggle for the observation layers. While a WMS overlay is
  // up all data layers are hidden anyway; the ref keeps the user's choice so
  // removeWmsOverlay restores it.
  // The "Hexes & points" picker. It owns the hex and point layers only — the
  // track layers belong to the trajectories switch (see trackLayerIds), so
  // hiding the hexes leaves any track lines drawn.
  useEffect(() => {
    dataLayersVisibleRef.current = dataLayersVisible
    if (!map.current || activeWmsOverlay) return
    setLayersVisibility(observationLayerIds, dataLayersVisible)
  }, [dataLayersVisible])

  // The depth-raster switch, on the legend's depth ramp. Unlike the observation
  // layers this is left alone by the WMS overlay: the depth wash sits under
  // everything and reads as basemap, so there is nothing for it to compete with.
  useEffect(() => {
    bathymetryVisibleRef.current = bathymetryVisible
    if (!map.current) return
    setLayersVisibility(bathymetryLayerIds, bathymetryVisible)
  }, [bathymetryVisible])

  // Layer-picker globe/mercator projection switch. Globe renders high
  // latitudes without Mercator distortion; MapLibre auto-interpolates back
  // to mercator at high zoom, so close-up interactions are unaffected. No
  // setStyle() calls exist (language switch uses setLayoutProperty), so the
  // projection persists until toggled here.
  useEffect(() => {
    if (!map.current) return
    map.current.setProjection({
      type: projection === 'globe' ? 'globe' : 'mercator'
    })
  }, [projection])

  // "Zoom to dataset": frame the requested footprint. The camera settings are
  // shared with ZoomToDataset, which compares them against the live camera to
  // decide whether the button still has anything to do.
  useEffect(() => {
    if (!map.current || !zoomTarget?.geometry) return
    const bounds = boundsFromGeoJson(zoomTarget.geometry)
    if (!bounds) return
    map.current.fitBounds(bounds, {
      ...zoomToDatasetCamera(),
      duration: 1000
    })
  }, [zoomTarget])

  // Spatial filter button (top bar): 'box'/'polygon' replace whatever was
  // drawn before and start that draw mode; 'clear' cancels out of drawing and
  // removes the shape. Mirrors the onclick handlers the map's own draw/trash
  // controls used to carry before they moved into the top bar.
  useEffect(() => {
    if (!drawRequest || !map.current) return
    if (drawRequest.mode === 'clear') {
      endDrawing()
      return
    }
    map.current.getCanvas().style.cursor = 'crosshair'
    deleteAllShapes()
    creatingPolygon.current = true
    drawPolygon.current.changeMode(
      drawRequest.mode === 'box' ? 'draw_rectangle' : 'draw_polygon'
    )
  }, [drawRequest])

  // Re-runs when the spatial filter changes too, so the overlay is re-requested
  // clipped to the new selection.
  useEffect(() => {
    if (!map.current) return
    polygonRef.current = polygon
    removeWmsOverlay()
    if (!activeWmsOverlay) {
      setGriddapHighlight(null)
      return
    }
    renderWmsImage(activeWmsOverlay)
    const rerender = debounce(() => renderWmsImage(activeWmsOverlay), 300)
    wmsMoveHandler.current = rerender
    map.current.on('moveend', rerender)
    setDataLayersVisibility(false)
    // pin the dataset's footprint outline while its overlay is shown
    setGriddapHighlight(activeWmsOverlay.bbox)
    return () => removeWmsOverlay()
  }, [activeWmsOverlay, polygon])

  function highlightPoints(polygon) {
    if (polygon && polygon.length >= 4) {
      const features = map.current
        .queryRenderedFeatures({ layers: ['points'] })
        .map((point) => {
          return {
            type: 'Feature',
            geometry: {
              type: 'Point',
              // Note order: longitude, latitude.
              coordinates: point.geometry.coordinates
            },
            properties: { ...point.properties }
          }
        })

      const featureCollection = { type: 'FeatureCollection', features }
      const searchWithin = helpers.polygon([polygon])
      const pointsWithinPolygon = turfPointsWithinPolygon(
        featureCollection,
        searchWithin
      )

      // Filter points layer to show the points that have been selected
      const filter = pointsWithinPolygon.features.reduce(
        function (memo, feature) {
          memo.push(feature.properties.pk)
          return memo
        },
        ['in', 'pk']
      )

      map.current.setFilter('points-highlighted', filter)
    }
  }


  // Latest map query, readable from the map 'load' closure (which would
  // otherwise build its tile URLs from the query as of the first render).
  const mapQueryRef = useRef(mapQueryString)
  mapQueryRef.current = mapQueryString

  // The one click listener is registered once, in the map-creation effect, so
  // it must not close over the first render's setter — read it through a ref.
  // (Selecting a trajectory used to need the same treatment, for the track
  // click handler; the card does that itself now, straight from the provider.)
  const onFeatureQueryRef = useRef(onFeatureQuery)
  onFeatureQueryRef.current = onFeatureQuery
  const onMarkerClickRef = useRef(onMarkerClick)
  onMarkerClickRef.current = onMarkerClick

  // Read by the track-focus paint (see applyTrackFocus). It also fed a
  // "click to show this platform's full track" line on the track tooltips,
  // which the chips dropped: every hover said the same thing, and it said it
  // about a gesture the user had not made yet.
  const selectedTrajectoryRef = useRef(selectedTrajectory)
  selectedTrajectoryRef.current = selectedTrajectory

  // The filter query and the data-layer selection combine into one suffix
  // shared by both source URLs — see buildTileSuffix. The two routes split the
  // zoom range for the same selection: /tiles folds the trajectory counts into
  // the combined green hexes below z7, /tiles/cells carries the dedicated
  // trajectory/OBIS coverage ramp at and above it. They take the same params so
  // the hex switch can't leave trajectory counts showing in one and not the other.
  const tileUrls = (queryString) => {
    const filterSuffix = buildTileSuffix(queryString, dataLayersRef.current)
    return {
      tileQuery: `${server}/tiles/{z}/{x}/{y}.mvt${filterSuffix}`,
      cellTileQuery: `${server}/tiles/cells/{z}/{x}/{y}.mvt${filterSuffix}`
    }
  }

  useEffect(() => {
    // Guard on source existence, not map.loaded(): the sources and layers are
    // all created together in the 'load' handler, so getSource('cde-tiles')
    // being present means the layers this effect touches (points-highlighted)
    // exist too. loaded() additionally requires no tiles in flight, which on a
    // heavy trajectory deployment dropped filter changes that arrived while
    // tiles were still loading (the reported "filters don't update the hexes"
    // bug). Before the map/sources exist there is nothing to swap.
    if (!map.current || !map.current.getSource('cde-tiles')) return

    map.current.setFilter('points-highlighted', ['in', 'pk', ''])

    // The hexes about to be drawn are a different population from the ones the
    // ramp was last measured over, so the measurement goes and the global tier
    // holds the ramp until the new tiles land (see resetViewportHexRange).
    resetViewportHexRange()
    refreshCombinedSources(mapQueryString)
    setLoading(true)
    doFinalCheck.current = true

    const drawnShape = drawPolygon.current.getAll().features[0]
    if (drawnShape) {
      const ring = drawnShape.geometry.coordinates[0]
      highlightPoints(ring)
      setPolygon(ring)
    } else {
      setPolygon()
    }
  }, [mapQueryString])

  // Geometry toggle: it changes the tile-URL params (profileTypes/
  // trajectoryTypes/includeObis/includeTrajectory), so it refetches the
  // combined/coverage-cell sources and re-applies layer visibility. The track
  // tiles carry trajectoryTypes too, so they refetch here as well — otherwise
  // switching one trajectory geometry off would leave its lines on screen until
  // the next scrub or filter change.
  useEffect(() => {
    dataLayersRef.current = dataLayers
    // Source existence, not map.loaded() — see the filter effect above.
    if (!map.current || !map.current.getSource('cde-tiles')) return
    // Adding or removing a geometry changes what the hexes sum, so the ramp's
    // measured domain goes with it.
    resetViewportHexRange()
    refreshCombinedSources(mapQueryString)
    if (tracksModeRef.current && anyTrajectoryLayerOn(dataLayers)) {
      refreshTracksSource(mapQueryString, scrubTimeRef.current, trailingDaysRef.current)
    }
    applyLayerVisibility()
  }, [dataLayers])

  // Track-lines switch: show/hide the track layers and load the scrub window.
  // No source refetch — the track lines come from their own /tiles/tracks
  // source, and unlike the old tracks *mode* this switch no longer pulls the
  // trajectory counts out of the hex tiles (that is the hex switch's job now),
  // so the combined sources are untouched.
  useEffect(() => {
    tracksModeRef.current = tracksMode
    if (!map.current || !map.current.getLayer('track-lines')) return
    applyLayerVisibility()
    if (tracksMode) {
      refreshTracksSource(mapQueryString, scrubTime, trailingDays)
    }
  }, [tracksMode])

  // Scrubbing / trailing-window / filter changes re-query the tracks tiles.
  useEffect(() => {
    scrubTimeRef.current = scrubTime
    trailingDaysRef.current = trailingDays
    if (!tracksMode) return
    refreshTracksSource(mapQueryString, scrubTime, trailingDays)
  }, [mapQueryString, scrubTime, trailingDays])

  // Selected platform: fetch its full track once (cached in rawTrackRef), dim
  // the global track layers, and fit the view to the track.
  useEffect(() => {
    // Clicking tracks on the map makes picking a second platform mid-fetch
    // routine (the table's one-row-at-a-time rhythm did not), so the in-flight
    // request is abandoned rather than left to land after the newer one and
    // draw the wrong track under the newer selection's name.
    const abortController = new AbortController()
    let superseded = false

    async function renderSelectedTrack() {
      if (!map.current || !map.current.getSource('selected-track')) return
      const source = map.current.getSource('selected-track')

      if (!selectedTrajectory) {
        rawTrackRef.current = null
        source.setData({ type: 'FeatureCollection', features: [] })
        // Back to whatever the dataset focus asks for — full colour when no
        // dataset page is open, the focused dataset's tracks alone when one is.
        applyTrackFocus()
        return
      }

      const { datasetPk, trajectoryId } = selectedTrajectory
      const cacheKey = `${datasetPk}|${trajectoryId}`
      if (rawTrackRef.current?.key !== cacheKey) {
        let track
        try {
          const response = await fetch(
            `${server}/trajectories/track?datasetPKs=${datasetPk}&trajectoryId=${encodeURIComponent(trajectoryId)}`,
            { signal: abortController.signal }
          )
          if (!response.ok) return
          track = await response.json()
        } catch (error) {
          reportError('track fetch failed', error)
          return
        }
        if (superseded) return
        rawTrackRef.current = {
          key: cacheKey,
          coordinates: track.coordinates,
          times: track.times
        }
      }
      const { coordinates: rawCoordinates, times: rawTimes } = rawTrackRef.current
      if (!rawCoordinates || rawCoordinates.length === 0) return

      // Split at the antimeridian and at large time gaps so a line never
      // spans the seam or a data gap (same segmentation rule as the
      // /tiles/tracks layer).
      const runs = splitTrackRuns(rawCoordinates, rawTimes)
      const lineFeatures = runs
        .filter((run) => run.length >= 2)
        .map((run) => ({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: run
          },
          properties: {}
        }))
      // Every raw fix, oriented by course over ground within its run: the
      // bearing from the previous fix (a run's first fix points toward its
      // next fix instead; coincident fixes inherit the last known course).
      // Bearings never span run breaks — direction across a data gap or the
      // antimeridian seam would be meaningless. cog stays unset when a run
      // has a single fix, which the -nocog circle layer picks up.
      // runs partitions rawCoordinates in place (every input point appears
      // exactly once, in order) so a running cursor recovers each point's
      // original fix time for the tooltip below.
      let rawIndex = 0
      const fixFeatures = runs.flatMap((run) => {
        let lastCog = null
        return run.map((coordinate, i) => {
          const time = rawTimes[rawIndex]
          rawIndex++
          const cog =
            i > 0
              ? initialBearing(run[i - 1], coordinate)
              : run.length > 1
                ? initialBearing(coordinate, run[1])
                : null
          if (cog !== null) lastCog = cog
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coordinate },
            properties: {
              ...(lastCog === null ? {} : { cog: lastCog }),
              time,
              trajectory_id: trajectoryId,
              dataset_title: selectedTrajectory.datasetTitle
            }
          }
        })
      })
      source.setData({
        type: 'FeatureCollection',
        features: [...lineFeatures, ...fixFeatures]
      })

      // Everything under the selected track goes flat grey so it reads alone.
      applyTrackFocus()

      const longitudes = rawCoordinates.map((c) => c[0])
      const latitudes = rawCoordinates.map((c) => c[1])
      // Same framing the "zoom to dataset" button uses: the track centred in the
      // canvas, with the sidebar left out of the reckoning.
      map.current.fitBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)]
        ],
        zoomToDatasetCamera()
      )
    }
    renderSelectedTrack()
    return () => {
      superseded = true
      abortController.abort()
    }
  }, [selectedTrajectory])

  const mapZoom = searchParams.get('zoom')
  const mapLongitude = searchParams.get('lon')
  const mapLatitude = searchParams.get('lat')

  useEffect(() => {
    // If already created don't proceed
    if (map.current) return
    // Create map
    map.current = new maplibreGl.Map({
      container: mapContainer.current,
      // Ocean-first basemap: bathymetry raster + vector rivers/boundaries and
      // FR/EN labels. Data layers are inserted below the label layers.
      //
      // The projection is part of the style in MapLibre 5, and it has to be
      // set here rather than left to the effect above: that effect's first run
      // happens while map.current is still null, and projection doesn't change
      // again, so a globe restored from localStorage would never be applied.
      style: {
        ...buildBasemapStyle(i18n.language),
        projection: { type: projection === 'globe' ? 'globe' : 'mercator' }
      },
      // MapLibre defaults to powerPreference 'high-performance', which wakes
      // the discrete GPU on dual-GPU laptops. The map is circles and fills —
      // the integrated GPU renders it fine, so hint 'low-power'.
      canvasContextAttributes: { powerPreference: 'low-power' },
      // No attribution in the map's own corner: the per-source attributions are
      // gathered by an AttributionControl the legend card builds and parents
      // itself (see LegendFooter.jsx).
      attributionControl: false,
      // Starting camera. The same share-link params and the same fallbacks
      // MapStateProvider seeds its mapView from — the two have to agree, or
      // the legend describes a zoom the map isn't at until the first moveend.
      center: [
        mapLongitude || defaultMapCenter.lon,
        mapLatitude || defaultMapCenter.lat
      ],
      zoom: mapZoom || defaultMapZoom,
      // Stop at the deepest level the satellite imagery actually exists at
      // everywhere it matters: Esri is cached to z17 on remote Arctic coasts
      // (z19 in cities), and past its coverage it serves a grey "map data not
      // yet available" tile rather than a 404. Capping the camera here means
      // that tile is never reached on land, without masking anything off.
      maxZoom: 17
    })
    // Share the instance with MapStateProvider (see mapRef there).
    if (mapRef) mapRef.current = map.current

    // disable map rotation using right click + drag
    map.current.dragRotate.disable()

    // disable map rotation using touch rotation gesture
    map.current.touchZoomRotate.disableRotation()

    map.current.on('load', () => {
      setColorStops()

      const { tileQuery, cellTileQuery } = tileUrls(mapQueryRef.current)

      // Two shared vector sources for all point/hex layers. Each layer used to
      // carry its own inline source — six separate copies of the same two tile
      // pyramids, each fetched and parsed independently on every pan. The
      // highlight layer renders nothing until a pk filter is set, and those pks
      // always come from queryRenderedFeatures on the filtered layers, so
      // sharing the filtered sources loses nothing.
      //
      // maxzoom stops at the level past which the server has nothing new to
      // say: routes/tiles.js selects individual points for any z >= 7, so a z17
      // tile is the same content as its z14 parent cut into 64 pieces — 64
      // ST_AsMVT queries for one tile's worth of data. Capping the source lets
      // MapLibre overzoom instead. Precision is unaffected in practice:
      // ST_AsMVTGeom at extent 4096 over a z14 tile is ~0.42 m/unit at 45°N,
      // finer than a z17 pixel (0.84 m). It matters more than the tile count
      // suggests, because every filter change calls setTiles below, which drops
      // the whole cache and refetches from scratch.
      //
      // promoteId lifts each feature's pk to its feature id, which is what
      // setFeatureState addresses — see the focus dimming above.
      map.current.addSource('cde-tiles', {
        type: 'vector',
        tiles: [tileQuery],
        maxzoom: 14,
        promoteId: 'pk'
      })
      map.current.addSource('cde-cells', {
        type: 'vector',
        tiles: [cellTileQuery],
        maxzoom: 14,
        promoteId: 'pk'
      })

      // Every data layer is inserted below the basemap's label layers
      // (beforeId FIRST_LABEL_LAYER_ID or an existing data layer) so water
      // and place names stay readable over hexes and points.
      map.current.addLayer({
        id: 'points',
        type: 'circle',
        minzoom: hexMaxZoom,
        source: 'cde-tiles',
        'source-layer': 'internal-layer-name',
        paint: {
          'circle-opacity': circleOpacity,
          'circle-radius': radiusExpression(pointRadiusRange.current),
          'circle-color': dimmable(colors),
          'circle-stroke-color': dimmable(colors),
          'circle-stroke-opacity': 0.001,
          'circle-stroke-width': 10
        }
      }, FIRST_LABEL_LAYER_ID)

      // Trajectory and OBIS coverage cells, always drawn as hexes. Inserted
      // with beforeId 'points' (which must already exist on the map —
      // MapLibre throws otherwise) so they sit at the bottom of the stack,
      // under the points layer. Below hexMaxZoom their counts are already
      // merged into the green 'hexes' layer; this layer only takes over once
      // profiles switch to points. A hex is coloured by what it holds —
      // trajectories, occurrence records, or both — see coverageHexFillColor.
      map.current.addLayer(
        {
          id: 'coverage-hexes',
          type: 'fill',
          minzoom: hexMaxZoom,
          source: 'cde-cells',
          'source-layer': 'coverage-hexes-layer',
          paint: {
            // Zero until the ramp is final — see revealHexes. Then data-driven:
            // hexes in the bottom quartile get 0.3 opacity, others get normal.
            'fill-opacity': hexesRevealed.current ? coverageHexOpacityExpression() : 0,
            'fill-color': dimmable(coverageHexFillColor()),
            'fill-outline-color': coverageHexOutlineColor()
          }
        },
        'points'
      )

      // Purely visual white casing under the points so they stay readable
      // over the coverage hex fills; all interaction stays on 'points',
      // which keeps its invisible wide-stroke hit area.
      map.current.addLayer(
        {
          id: 'points-halo',
          type: 'circle',
          minzoom: hexMaxZoom,
          source: 'cde-tiles',
          'source-layer': 'internal-layer-name',
          paint: {
            'circle-color': '#ffffff',
            // A white casing is what makes a marker pop, which is the last
            // thing a greyed-out one should do — it shares this source layer
            // with 'points', so the same dimmed state reaches it and fades it
            // back rather than leaving grey dots ringed in white. Only halfway
            // back: the other datasets stay on the map to be seen, just
            // quietly, and the casing is what keeps a grey dot legible over a
            // dark sea.
            'circle-opacity': ['case', IS_DIMMED, 0.5, 0.9],
            'circle-radius': radiusExpression(pointRadiusRange.current, 1.25)
          }
        },
        'points'
      )

      map.current.addLayer({
        id: 'hexes',
        type: 'fill',
        minzoom: hexMinZoom,
        maxzoom: hexMaxZoom,
        source: 'cde-tiles',
        'source-layer': 'internal-layer-name',

        paint: {
          // Zero until the ramp is final — see revealHexes. Then data-driven:
          // hexes in the bottom quartile get 0.3 opacity, others get normal.
          'fill-opacity': hexesRevealed.current ? hexOpacityExpression() : 0,
          // A real interpolate expression rather than the legacy
          // { property, stops } paint function, because that form cannot be
          // nested inside the 'case' dimmable wraps it in — the same reason
          // coverageHexFillColor builds its ramps through rampExpression.
          'fill-color': dimmable(hexFillColor())
        }
      }, FIRST_LABEL_LAYER_ID)

      map.current.addLayer({
        id: 'points-highlighted',
        type: 'circle',
        minzoom: hexMaxZoom,
        source: 'cde-tiles',
        'source-layer': 'internal-layer-name',
        paint: {
          'circle-color': dimmable(colors),
          'circle-opacity': circleOpacity,
          'circle-radius': radiusExpression(pointRadiusRange.current),
          'circle-stroke-color': 'black',
          // The selection ring is dropped on dimmed points: a focused dataset
          // greys the rest of the map, and a black ring around a grey circle
          // would still read as picked out.
          'circle-stroke-width': ['case', IS_DIMMED, 0, 0.75]
        },
        filter: ['in', 'pk', '']
      }, FIRST_LABEL_LAYER_ID)

      // Griddap (gridded, metadata-only) datasets: the optional coverage
      // layer (all matching bboxes, toggled off by default) and the
      // single-dataset highlight (hover from the list / pinned while a WMS
      // overlay is shown). GeoJSON sources — coverage is tens of features
      // served whole by /griddapCoverage, not tiles. Inserted before
      // 'points-highlighted' so selection/hover circles stay on top.
      map.current.addSource('griddap-coverage', {
        type: 'geojson',
        // pk as the feature id so the hover feature-state below can address
        // individual rectangles.
        promoteId: 'pk',
        data: griddapCoverageRef.current || emptyFeatureCollection
      })
      map.current.addSource('griddap-highlight', {
        type: 'geojson',
        data: emptyFeatureCollection
      })
      map.current.addLayer(
        {
          id: 'griddap-coverage-fill',
          type: 'fill',
          source: 'griddap-coverage',
          // Light wash at rest, a touch stronger on hover. Kept low because
          // overlapping rectangles composite: a dozen grids stacked over the
          // same water turn any generous fill into a solid slab, so the hover
          // affordance leans on the outline below rather than the fill.
          paint: {
            'fill-color': '#52a79b',
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hovered'], false],
              0.12,
              0.07
            ]
          }
        },
        'points-highlighted'
      )
      map.current.addLayer(
        {
          id: 'griddap-coverage-line',
          type: 'line',
          source: 'griddap-coverage',
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'hovered'], false],
              '#fbb03b',
              '#52a79b'
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'hovered'], false],
              2.5,
              1.5
            ],
            'line-dasharray': [2, 2]
          }
        },
        'points-highlighted'
      )
      map.current.addLayer(
        {
          id: 'griddap-highlight-fill',
          type: 'fill',
          source: 'griddap-highlight',
          paint: { 'fill-color': '#fbb03b', 'fill-opacity': 0.1 }
        },
        'points-highlighted'
      )
      map.current.addLayer(
        {
          id: 'griddap-highlight-line',
          type: 'line',
          source: 'griddap-highlight',
          paint: { 'line-color': '#fbb03b', 'line-width': 2.5 }
        },
        'points-highlighted'
      )

      // --- Clicked region ---------------------------------------------------
      // What the "what's here" card is talking about. Added last of the overlay
      // layers and never given a beforeId, so it draws over every data layer —
      // the whole job is being unmistakable, and a highlight the markers cover
      // is no highlight. Cleared when the card closes.
      map.current.addSource('click-highlight', {
        type: 'geojson',
        data: emptyFeatureCollection
      })
      // The flat merged fill goes down first. A stack of grid boxes draws its
      // glow (below) per individual box, not once for the merged shape — put
      // the fill on top of that glow instead and every box nested inside the
      // stack has its glow smothered from both sides by the fill covering it,
      // leaving only the outermost box's glow poking out past the fill's own
      // edge. That read as "just the biggest box got selected" even though
      // every box was outlined and listed correctly.
      map.current.addLayer({
        id: 'click-highlight-fill',
        type: 'fill',
        source: 'click-highlight',
        // Excludes the individual grid rectangles, which the merged stand-in
        // shape fills on their behalf — see the `role` comment in
        // buildFeatureQuery. Painting both would compound a stack's opacity;
        // painting only the individual boxes is exactly what this avoids.
        filter: [
          'all',
          ['!=', ['geometry-type'], 'Point'],
          ['!=', ['get', 'role'], 'outline']
        ],
        paint: {
          'fill-color': clickHighlightColor,
          'fill-opacity': 0.18
        }
      })
      // A soft blurred halo under the crisp outline/point below, so the
      // selected item reads as picked out at a glance instead of just
      // outlined. Point and polygon geometries blur through different paint
      // properties (circle-blur vs. line-blur), so each gets its own layer.
      // Painted after the fill above so every box's glow shows through it,
      // not just the outermost one's.
      map.current.addLayer({
        id: 'click-highlight-glow',
        type: 'line',
        source: 'click-highlight',
        // Excludes the fill-only merged grid shape — see click-highlight-fill.
        filter: [
          'all',
          ['!=', ['geometry-type'], 'Point'],
          ['!=', ['get', 'role'], 'fill']
        ],
        paint: {
          'line-color': clickHighlightColor,
          'line-width': 10,
          'line-blur': 8,
          'line-opacity': 0.85
        }
      })
      map.current.addLayer({
        id: 'click-highlight-point-glow',
        type: 'circle',
        source: 'click-highlight',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': radiusExpression(pointRadiusRange.current, 6),
          'circle-color': clickHighlightColor,
          'circle-blur': 0.8,
          'circle-opacity': 0.85
        }
      })
      map.current.addLayer({
        id: 'click-highlight-line',
        type: 'line',
        source: 'click-highlight',
        // Excludes the fill-only merged grid shape: it exists purely to give
        // the fill layer a flat-opacity stand-in, and its outline would just
        // duplicate the outer envelope of the individual boxes drawn here.
        filter: [
          'all',
          ['!=', ['geometry-type'], 'Point'],
          ['!=', ['get', 'role'], 'fill']
        ],
        paint: {
          'line-color': clickHighlightColor,
          'line-width': 2.5
        }
      })
      // A marker is outlined, not enlarged and not filled: it keeps the size the
      // ramp gave it (so the legend's size key still reads true) and the
      // platform colour underneath stays visible. The radius is the same
      // expression 'points' paints with, evaluated against the `count` carried
      // on the highlight feature, so the ring sits exactly on the marker's edge
      // rather than around it.
      //
      // The marker's own circle-stroke can't be used for this: it is the
      // invisible 10px hit halo (see the 'points' paint), 2-4x the drawn circle.
      map.current.addLayer({
        id: 'click-highlight-point',
        type: 'circle',
        source: 'click-highlight',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': radiusExpression(pointRadiusRange.current),
          'circle-color': 'rgba(0, 0, 0, 0)',
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 1.5
        }
      })

      // --- Track-line layers ---------------------------------------------
      // Track lines + head positions from /tiles/tracks, shown only when the
      // track-lines switch is on. Independent of the trajectory hex layers —
      // both can draw at once. Created via refs so the current switch state and
      // scrub window apply even though this load handler runs once.
      const tracksVisibility = tracksModeRef.current ? 'visible' : 'none'
      map.current.addSource('tracks', {
        type: 'vector',
        // No minzoom: track lines/heads render at every zoom level, including
        // fully zoomed out. maxzoom caps the fetched tile zoom at 8 and lets
        // maplibre overzoom past it rather than re-fetch expensive tiles at
        // every zoom level in. NOTE: at low zoom a single tile can assemble
        // every trajectory over the whole time window (100k+ features,
        // multi-MB) — the bounded default trail (defaultTrailingDays) and the
        // long-trail zoom gate (effectiveTrailingDays, both in config.js) keep
        // that in check. If it regresses, add server-side low-zoom
        // simplification in web-api/routes/tiles.js rather than a minzoom.
        maxzoom: 8,
        tiles: [
          buildTracksTileUrl(
            mapQueryRef.current,
            scrubTimeRef.current,
            trailingDaysRef.current,
            map.current.getZoom()
          )
        ]
      })
      appliedTrailRef.current = effectiveTrailingDays(
        trailingDaysRef.current,
        map.current.getZoom()
      )

      // Crossing the long-trail zoom gate changes the window the tracks tiles
      // carry, so the source is rebuilt — but only on an actual crossing, not
      // on every zoomend, since setTiles drops the whole tile cache.
      map.current.on('zoomend', () => {
        if (!tracksModeRef.current || !map.current.getSource('tracks')) return
        const effective = effectiveTrailingDays(
          trailingDaysRef.current,
          map.current.getZoom()
        )
        if (effective === appliedTrailRef.current) return
        refreshTracksSource(
          mapQueryRef.current,
          scrubTimeRef.current,
          trailingDaysRef.current
        )
      })

      map.current.addLayer({
        id: 'track-lines',
        type: 'line',
        source: 'tracks',
        'source-layer': 'track-lines',
        layout: {
          visibility: tracksVisibility,
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': trackLineColor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1, 10, 2.5],
          // Partial opacity so coincident tracks compound: many voyages ply
          // the same shipping corridor (27 St. Lawrence voyages in a 90-day
          // window overlap into what full opacity renders as ONE line), and
          // stacked translucent lines read as a visibly busier corridor.
          'line-opacity': 0.55
        }
      })

      // No per-fix markers on the global tracks layer: clicking a track draws
      // that platform's full history with a marker at every fix ('selected-track'
      // below), which is the detail view breadcrumb dots only hinted at.
      //
      // Heads with a known course over ground render as arrowheads rotated
      // to the direction of travel; heads where cog is undefined (single-fix
      // trajectories, stationary platforms) fall back to circles.
      map.current.addImage('track-head-arrow', buildHeadArrowImage(trackLineColor), {
        pixelRatio: 2
      })
      map.current.addImage('track-head-arrow-dim', buildHeadArrowImage('lightgrey'), {
        pixelRatio: 2
      })

      map.current.addLayer({
        id: 'track-heads',
        type: 'symbol',
        source: 'tracks',
        'source-layer': 'track-heads',
        filter: ['has', 'cog'],
        layout: {
          visibility: tracksVisibility,
          'icon-image': 'track-head-arrow',
          'icon-rotate': ['get', 'cog'],
          // rotate with the map, not the viewport, so the arrow keeps
          // pointing along the geographic course
          'icon-rotation-alignment': 'map',
          // Collision culling is zoom-gated at hexMaxZoom (7). Below it a tile
          // can carry ~100k heads (whole catalogue at low zoom) — forcing every
          // one to render overwhelms the tab, so let maplibre drop overlapping
          // arrows there. At/above z7 a tile covers a small enough area that the
          // head count is a few hundred, so overlap/ignore-placement are safe
          // and every heading stays visible (the /tiles/tracks per-tile cap also
          // bounds the count). z7 is the same breakpoint hexes→points use.
          'icon-allow-overlap': ['step', ['zoom'], false, hexMaxZoom, true],
          'icon-ignore-placement': ['step', ['zoom'], false, hexMaxZoom, true],
          // When culling (below z7), keep the most recent heads deterministically
          // rather than an arbitrary subset.
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'head_time'], 0]]
        }
      })

      map.current.addLayer({
        id: 'track-heads-fixed',
        type: 'circle',
        source: 'tracks',
        'source-layer': 'track-heads',
        filter: ['!', ['has', 'cog']],
        layout: { visibility: tracksVisibility },
        paint: {
          'circle-color': trackLineColor,
          'circle-radius': 4.5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5
        }
      })

      // These three layers were just created in full colour, so whatever focus
      // paint was on the old ones is gone with them.
      trackFocusApplied.current = undefined
      applyTrackFocus()

      // One selected platform's full track (GeoJSON from /trajectories/track).
      // Line features render the path; point features are the raw fixes.
      map.current.addSource('selected-track', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })

      map.current.addLayer({
        id: 'selected-track-line',
        type: 'line',
        source: 'selected-track',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': selectedTrackColor,
          'line-width': 3
        }
      })

      // Raw fixes with a known course over ground render as arrowheads
      // (white fill, selected-track-coloured outline — the inverse of the
      // global heads, matching the old fix circles); fixes where cog is
      // undefined (singleton runs) keep circles.
      map.current.addImage(
        'selected-fix-arrow',
        buildHeadArrowImage('#ffffff', selectedTrackColor),
        { pixelRatio: 2 }
      )

      map.current.addLayer({
        id: 'selected-track-fixes',
        type: 'symbol',
        source: 'selected-track',
        // full expression syntax ('geometry-type', not the legacy '$type'):
        // MapLibre 5 rejects filters that mix legacy and expression operators
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'cog']],
        layout: {
          'icon-image': 'selected-fix-arrow',
          'icon-size': 0.75,
          'icon-rotate': ['get', 'cog'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      })

      map.current.addLayer({
        id: 'selected-track-fixes-nocog',
        type: 'circle',
        source: 'selected-track',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'cog']]],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 3,
          'circle-stroke-color': selectedTrackColor,
          'circle-stroke-width': 1.5
        }
      })

      // Apply the initial track-layer visibility from the URL-restored
      // track-lines switch + data-layer selection.
      applyLayerVisibility()

      // Layers are created visible; re-apply the picker state in case the hex
      // and point layers were toggled off before the style finished loading.
      // The track layers are not the picker's to hide, so they are left alone.
      if (!dataLayersVisibleRef.current) {
        setLayersVisibility(observationLayerIds, false)
      }
      // Same for the depth rasters, which come from the style itself and are
      // therefore always created visible.
      if (!bathymetryVisibleRef.current) {
        setLayersVisibility(bathymetryLayerIds, false)
      }

      // A share link can carry the spatial selection (rectangle bounds or a
      // polygon ring). SelectionProvider has already seeded it into the app
      // state — this puts the shape back into the draw control so it is drawn,
      // editable, and survives the next filter change (which re-derives the
      // selection from whatever the draw control holds).
      const sharedSelection = selectionFromSearchParams(
        new URL(window.location.href).searchParams
      )
      if (sharedSelection) {
        const [featureId] = drawPolygon.current.add({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [sharedSelection] }
        })
        drawPolygon.current.changeMode('direct_select', { featureId })
        highlightPoints(sharedSelection)
      }
    })

    // Clickable track layers, most-deliberate target first: an arrowhead is
    // aimed at (it is what the head tooltip describes), the line is the fallback.
    const trackClickLayers = ['track-heads', 'track-heads-fixed', 'track-lines']

    // The selected platform's own drawing, which sits over the tile layers.
    const selectedTrackLayers = [
      'selected-track-fixes',
      'selected-track-fixes-nocog',
      'selected-track-line'
    ]

    // 'points' carries an invisible 10px hit stroke so small circles stay easy
    // to hit (see its paint), but that halo is 2-4x the circle actually drawn —
    // standing aside for all of it would leave track lines un-hoverable at z7+
    // (where points appear) anywhere profiles are dense, which is most of the
    // coast. A track yields only to the circle the user can see, plus a pixel
    // or two of grace.
    //
    // These precedence tests are now hover-only. Click used to run the same
    // ladder — eight mutual stand-aside functions deciding which of six
    // handlers owned a given pixel — and it is gone: one click gathers
    // everything under it and the card lists it (see handleMapClick). Hover
    // still has to pick a single winner, because there is only one tooltip.
    const POINT_HIT_GRACE_PX = 2
    const isOnAPointIn = (hits, point) =>
      hits
        .filter((feature) => feature.layer.id === 'points')
        .some((feature) => {
          const centre = map.current.project(feature.geometry.coordinates)
          const radius =
            pointRadiusFor(feature.properties.count) + POINT_HIT_GRACE_PX
          return (
            (centre.x - point.x) ** 2 + (centre.y - point.y) ** 2 <= radius ** 2
          )
        })

    // The track feature under a point, ranked by trackClickLayers rather than by
    // render order, so a head from one trajectory and a line from another under
    // the same cursor resolve the same way every time.
    const trackFeatureIn = (hits) =>
      hits
        .filter((feature) => trackClickLayers.includes(feature.layer.id))
        .sort(
          (a, b) =>
            trackClickLayers.indexOf(a.layer.id) -
            trackClickLayers.indexOf(b.layer.id)
        )[0]

    // Griddap coverage rectangles defer to the point/hex layers, so a hover
    // meant for an observation isn't swallowed by the grid drawn over it. Past
    // griddapPriorityZoom the rectangles outrank the hex aggregates instead:
    // the hexes are a coarse backdrop by then, and someone zoomed in that far
    // is working with a specific grid.
    const griddapCoveredIn = (hits) => {
      const covering =
        map.current.getZoom() >= griddapPriorityZoom
          ? ['points']
          : ['points', 'hexes']
      return (
        hits.some((feature) => covering.includes(feature.layer.id)) ||
        Boolean(trackFeatureIn(hits))
      )
    }

    const griddapOutranksHexesIn = (hits) =>
      map.current.getZoom() >= griddapPriorityZoom &&
      hits.some((feature) => feature.layer.id === 'griddap-coverage-fill')

    // The whole hover vocabulary: one line, no markup, no click hint.
    //
    // Every tooltip here used to carry a bold dataset title, a secondary line or
    // two, and a "Click to …" hint — a card's worth of content in a popup, shown
    // on a gesture the user did not ask anything with. All of it is one click
    // away in the real card now, and the hint is the same sentence everywhere,
    // so hover is back to what it is good at: naming the thing under the cursor
    // so you know it is hittable. Titles are truncated rather than wrapped, so
    // the chip stays one line whatever it is given.
    const CHIP_MAX_CHARS = 34
    const showChip = (lngLat, text) => {
      const label = String(text ?? '').trim()
      if (!label) {
        popup.remove()
        return
      }
      const clipped =
        label.length > CHIP_MAX_CHARS
          ? `${label.slice(0, CHIP_MAX_CHARS - 1)}…`
          : label
      popup
        .setLngLat(lngLat)
        .setHTML(`<span class="mapChip">${escapeHtml(clipped)}</span>`)
        .addTo(map.current)
    }

    // Rebuilding the tooltip on every mousemove made it flicker, so the content
    // is settled on a short debounce. Crossing into a rectangle whose stack is
    // unchanged only moves the popup — no DOM rebuild, no feature-state churn.
    const showGriddapTooltip = debounce((e, features) => {
      const sameStack =
        features.length === hoveredGriddapIds.current.length &&
        features.every(
          (feature, index) => feature.id === hoveredGriddapIds.current[index]
        )
      popup.setLngLat([e.lngLat.lng, e.lngLat.lat])
      if (sameStack && popup.isOpen()) return

      setGriddapHovered(features)
      // One rectangle names itself; a stack just says how many. The titles used
      // to be previewed three at a time here — that is the card's job now.
      showChip(
        e.lngLat,
        features.length > 1
          ? t('mapChipGridStack', { n: features.length })
          : griddapTitle(features[0])
      )
    }, 80)

    // --- Hover -------------------------------------------------------------
    // One handler, one hit-test, once per frame.
    //
    // MapLibre implements a per-layer listener by running its own
    // queryRenderedFeatures on every raw mousemove, and a 'mouseleave'
    // registration installs a querying 'mousemove' delegate of its own — so the
    // nine hover layers here cost eighteen hit-tests per mouse event before a
    // single handler body ran, plus the half-dozen more the bodies fired at each
    // other to settle precedence. Over dense coastline at z16 that was the most
    // expensive thing the map did, and it ran at the mouse's polling rate.
    //
    // The precedence those handlers encoded — partly through mutual stand-aside
    // checks, partly through registration order, since the last one to run won
    // the popup — is written out here instead and resolved against a single set
    // of features. Highest priority first:
    //
    //   1. griddap rectangles, unless an observation or a track is under the
    //      cursor (griddapCoveredIn). They come first because their handler was
    //      registered last and so overwrote everything that had already written
    //      a tooltip — including the selected fixes, which their covered-test
    //      does not look at.
    //   2. the selected platform's own fixes: drawn over the tile layers and
    //      deliberately unguarded, so they keep their timestamp tooltip
    //   3. track lines, unless a point, a head or a selected fix is
    //   4. track heads, unless a point is
    //   5. points
    //   6. coverage hexes, unless a point is — points draw over them
    //   7. profile hexes, unless the rectangles outrank them at this zoom
    const hoverRules = [
      {
        id: 'griddap',
        layers: ['griddap-coverage-fill'],
        when: (hits) => !griddapCoveredIn(hits),
        show: (e, features) => showGriddapTooltip(e, dedupeGriddapByPk(features))
      },
      {
        id: 'selected-fixes',
        layers: ['selected-track-fixes', 'selected-track-fixes-nocog'],
        // The date is the whole point of hovering a fix on the drawn track —
        // the platform is already named in the page that drew it.
        show: (e, features) =>
          showChip(
            e.lngLat,
            features[0].properties.time
              ? features[0].properties.time.slice(0, 10)
              : features[0].properties.trajectory_id
          )
      },
      {
        id: 'track-lines',
        layers: ['track-lines'],
        when: (hits, point) =>
          !isOnAPointIn(hits, point) &&
          !hits.some((feature) =>
            ['track-heads', 'track-heads-fixed', ...selectedTrackLayers].includes(
              feature.layer.id
            )
          ),
        // The platform, which is what tells one of a dozen crossing lines from
        // another. Its dataset is in the card.
        show: (e, features) =>
          showChip(e.lngLat, features[0].properties.trajectory_id)
      },
      {
        id: 'track-heads',
        layers: ['track-heads', 'track-heads-fixed'],
        when: (hits, point) => !isOnAPointIn(hits, point),
        show: (e, features) =>
          showChip(e.lngLat, features[0].properties.trajectory_id)
      },
      {
        id: 'points',
        layers: ['points'],
        show: (e, features) =>
          showChip(
            // the circle's own centre, not the cursor, so the chip sits on the
            // point it describes
            features[0].geometry.coordinates.slice(),
            metricCountLabel(features[0].properties.count)
          )
      },
      {
        id: 'coverage-hexes',
        layers: ['coverage-hexes'],
        when: (hits) => !hits.some((feature) => feature.layer.id === 'points'),
        // Just the figure the colour encodes. The trajectory/OBIS breakdown that
        // used to hang off this went with the rest of the hover detail.
        show: (e, features) =>
          showChip(e.lngLat, metricCountLabel(features[0].properties.count))
      },
      {
        id: 'hexes',
        layers: ['hexes'],
        when: (hits) => !griddapOutranksHexesIn(hits),
        show: (e, features) =>
          showChip(e.lngLat, metricCountLabel(features[0].properties.count))
      }
    ]

    // Every layer the rules render, plus the ones only their guards read:
    // 'selected-track-line' has no tooltip of its own but track-lines stands
    // aside for it.
    const hoverLayerIds = [
      ...new Set([
        ...hoverRules.flatMap((rule) => rule.layers),
        'selected-track-line'
      ])
    ]

    const handleHover = (e) => {
      // Drawing owns the cursor and the canvas; leave the popup exactly as the
      // last hover left it, which is what the per-layer handlers did too.
      if (draw.getMode().includes('draw')) {
        showGriddapTooltip.cancel()
        setGriddapHovered([])
        return
      }

      const layers = hoverLayerIds.filter((id) => map.current.getLayer(id))
      const hits = layers.length
        ? map.current.queryRenderedFeatures(e.point, { layers })
        : []

      const winner = hoverRules.find((rule) => {
        const features = hits.filter((feature) =>
          rule.layers.includes(feature.layer.id)
        )
        return (
          features.length > 0 && (!rule.when || rule.when(hits, e.point))
        )
      })

      // The rectangles' hover outline is feature-state, not a popup, so it has
      // to be released whenever they aren't the winner — the old mouseleave
      // handler's job.
      if (winner?.id !== 'griddap') {
        showGriddapTooltip.cancel()
        setGriddapHovered([])
      }

      if (!winner) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
        return
      }

      map.current.getCanvas().style.cursor = 'pointer'
      winner.show(
        e,
        hits.filter((feature) => winner.layers.includes(feature.layer.id))
      )
    }

    // Coalesced to one hit-test per frame, on the newest cursor position rather
    // than the first of the batch.
    let pendingHover = null
    let hoverFrame = null
    map.current.on('mousemove', (e) => {
      setHoveredDataset()
      pendingHover = e
      if (hoverFrame !== null) return
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = null
        const event = pendingHover
        pendingHover = null
        if (event && map.current) handleHover(event)
      })
    })

    // No mousemove fires once the cursor leaves the canvas, so the popup would
    // otherwise stay behind.
    map.current.on('mouseout', () => {
      if (hoverFrame !== null) {
        cancelAnimationFrame(hoverFrame)
        hoverFrame = null
      }
      pendingHover = null
      showGriddapTooltip.cancel()
      setGriddapHovered([])
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
      }
    })

    // --- Click ---------------------------------------------------------------
    // One handler, one hit-test, one outcome: report what is under the click and
    // let the card offer the actions.
    //
    // This replaces six competing handlers (points, hexes, coverage hexes,
    // griddap rectangles, tracks, and a map-wide fallback) which between them
    // did five unrelated things to the same gesture — fly the camera to zoom 7,
    // build a hidden 20px bbox filter, overwrite the dataset filter, open a
    // dataset page, or clear the selection — and needed a ladder of mutual
    // stand-aside tests to decide which. Nothing here changes the camera or a
    // filter; every consequence is a button in the card.
    //
    // 'points' and the hex layers carry `datasets`, a JSON array of dataset
    // pk_urls, and `count`, the metric the ramp colours by. The griddap
    // rectangles carry a single pk. Titles are not on the tiles at all — the
    // card resolves the pks against the current results, which is also what
    // keeps it honest about what is actually in the list.
    const clickLayerIds = [
      ...trackClickLayers,
      ...selectedTrackLayers,
      'points',
      'coverage-hexes',
      'hexes',
      'griddap-coverage-fill'
    ]

    const datasetPksOf = (feature) => {
      try {
        const pks = JSON.parse(feature.properties.datasets)
        return Array.isArray(pks) ? pks.map(Number) : []
      } catch (error) {
        return []
      }
    }

    // Everything one click found, grouped the way the card reads it out. Returns
    // null when the click landed on empty water.
    const buildFeatureQuery = (e, hits) => {
      if (hits.length === 0) return null

      // Tracks first and deduped by (dataset, trajectory): a click on an
      // arrowhead sitting on its own line hits both layers, and a track that
      // doubles back can be hit several times over.
      const tracks = []
      const seenTracks = new Set()
      hits
        .filter((feature) =>
          [...trackClickLayers, ...selectedTrackLayers].includes(feature.layer.id)
        )
        .forEach((feature) => {
          const {
            pk_url: pk,
            trajectory_id: trajectoryId,
            dataset_title: datasetTitle
          } = feature.properties
          // trajectory_id is '' for a dataset with a single unnamed trajectory
          // (the schema default) and that is a valid selection end to end, so
          // test for absence rather than falsiness.
          if (pk == null || trajectoryId == null) return
          const key = `${pk}:${trajectoryId}`
          if (seenTracks.has(key)) return
          seenTracks.add(key)
          tracks.push({
            kind: 'track',
            pk: Number(pk),
            trajectoryId,
            title: datasetTitle
          })
        })

      // Observations: individual markers where they are drawn, the aggregate
      // cell otherwise. A marker also names its platform, which the cell can't.
      //
      // Deduped by (layer, pk) first. A cell or marker that straddles a tile
      // boundary is returned once per tile it appears in, and counting it twice
      // inflated the card's total; drawing it twice turned the clicked-region
      // outline into a scribble of near-coincident hexagons.
      const observationHits = []
      const seenObservations = new Set()
      hits.forEach((feature) => {
        const layerId = feature.layer.id
        if (!['points', 'hexes', 'coverage-hexes'].includes(layerId)) return
        const key = `${layerId}:${feature.properties.pk}`
        if (seenObservations.has(key)) return
        seenObservations.add(key)
        observationHits.push(feature)
      })

      const observations = new Map()
      let observationCount = 0
      const cellFeatures = []
      observationHits.forEach((feature) => {
        const layerId = feature.layer.id
        const count = Number(feature.properties.count) || 0
        observationCount += count
        // A hex is one row server-side, but MVT clips it to whichever tiles
        // it crosses — at low zoom it fits inside a single tile, at high
        // zoom (e.g. z10) the same hex spans several, and `feature` above is
        // only the fragment the click point happened to land in. Pull every
        // currently-rendered fragment sharing this pk so the highlight/bounds
        // below cover the whole hex instead of the one sliver under the
        // cursor.
        //
        // The fragments still meet at the tile edge they were clipped along,
        // so unioning them back into one polygon isn't just cosmetic tidying
        // — without it, click-highlight-line/glow draw that internal edge as
        // a line cutting across the hex, on top of drawing its true outline.
        if (layerId !== 'points') {
          const fragments = map.current.queryRenderedFeatures({
            layers: [layerId],
            filter: ['==', ['get', 'pk'], feature.properties.pk]
          })
          const parts = fragments.length ? fragments : [feature]
          let merged = parts[0]
          for (let i = 1; i < parts.length; i++) {
            try {
              merged = turfUnion(merged, parts[i]) || merged
            } catch (error) {
              // A degenerate fragment (e.g. a sliver from the MVT buffer
              // overlap) fails to union — keep what merged so far rather
              // than losing the highlight entirely.
            }
          }
          cellFeatures.push(merged)
        }
        datasetPksOf(feature).forEach((pk) => {
          const existing = observations.get(pk)
          if (existing) {
            existing.count += count
            existing.platform = existing.platform || feature.properties.platform
            return
          }
          observations.set(pk, {
            kind: 'observation',
            pk,
            count,
            platform: feature.properties.platform,
            // A marker is a place the user can point at; a cell is a
            // neighbourhood. The card says which it is rather than implying a
            // precision the aggregate doesn't have.
            aggregate: layerId !== 'points'
          })
        })
      })

      // Gridded footprints, deduped by dataset — a stack of grids covering the
      // same water is the norm, not the exception.
      const gridFeatures = dedupeGriddapByPk(
        hits.filter((feature) => feature.layer.id === 'griddap-coverage-fill')
      )
      const grids = gridFeatures.map((feature) => ({
        kind: 'grid',
        pk: Number(feature.properties.pk),
        title: griddapTitle(feature)
      }))

      const items = [...tracks, ...observations.values(), ...grids]
      if (items.length === 0) return null

      // What the click actually landed on, drawn back onto the map so the card
      // has something to point at. Without it the card was a panel of titles
      // floating over an unchanged map, and nothing said which of forty
      // identical hexes it was describing.
      //
      // Areas (hexes, coverage hexes, grid rectangles) are outlined; individual
      // markers are ringed. They stay in one collection — the highlight layers
      // filter on geometry type — but only the areas can be framed.
      //
      // Grid rectangles routinely stack — a dozen gridded datasets can share
      // the same patch of ocean — and click-highlight-fill paints every area
      // feature as its own translucent polygon, so pushing one per dataset
      // would compound into a darker patch the more of them overlap here.
      // A single unioned shape fixes the opacity, but painting *only* that
      // shape (dropping the individual rectangles) collapses nested/uneven
      // boxes down to just their outer envelope — the small ones disappear
      // and it reads as "just the biggest box got selected". So both are
      // kept, tagged with the `role` the highlight layers filter on: the
      // merged shape feeds the fill and only the fill ('fill'), the
      // individual rectangles feed the outline and glow and only those
      // ('outline'), so every box in the stack still draws its own border.
      // Everything else is drawn by all of them ('both').
      let mergedGrid = gridFeatures[0] || null
      for (let i = 1; i < gridFeatures.length; i++) {
        try {
          mergedGrid = turfUnion(mergedGrid, gridFeatures[i]) || mergedGrid
        } catch (error) {
          // A degenerate polygon fails to union — keep what merged so far
          // rather than losing the highlight entirely.
        }
      }

      // A feature from queryRenderedFeatures is a MapLibre GeoJSONFeature,
      // whose `geometry` is a getter on the prototype: it has to be read off
      // the live object here, and a feature can never be tagged by spreading
      // it (`{ ...feature, role }` copies own properties only, silently
      // dropping the geometry and leaving the highlight with nothing to
      // draw). Hence the (feature, role) pairs rather than tagged copies.
      const highlightFeature = ({ feature, role }) => ({
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          // `count` rides along because click-highlight-point sizes itself
          // with the same ramp 'points' does, and that expression reads it.
          // A unioned shape carries turf's empty properties, but only the
          // point layers read `count`, and those are never unioned.
          count: Number(feature.properties?.count) || 0,
          role
        }
      })

      const areaHighlights = [
        ...cellFeatures.map((feature) => ({ feature, role: 'both' })),
        ...gridFeatures.map((feature) => ({ feature, role: 'outline' })),
        ...(mergedGrid ? [{ feature: mergedGrid, role: 'fill' }] : [])
      ].map(highlightFeature)

      const highlight = {
        type: 'FeatureCollection',
        features: [
          ...areaHighlights,
          ...observationHits
            .filter((feature) => feature.layer.id === 'points')
            .map((feature) => highlightFeature({ feature, role: 'both' }))
        ]
      }

      // "Zoom here" frames the cell that was clicked where there is one, so the
      // old hex click's zoom-to-7 is still reachable — as a button, and framing
      // the actual cell instead of a fixed zoom level. A lone marker has no
      // area to frame, so it gets no button rather than one that jumps the
      // camera to nothing.
      let bounds = null
      if (areaHighlights.length > 0) {
        try {
          const box = turfBbox({
            type: 'FeatureCollection',
            features: areaHighlights
          })
          bounds = [
            [box[0], box[1]],
            [box[2], box[3]]
          ]
        } catch (error) {
          bounds = null
        }
      }

      return {
        // A nonce, so clicking the same spot twice re-opens a card the user
        // dismissed rather than being deduped away by React.
        nonce: Date.now(),
        lngLat: [e.lngLat.lng, e.lngLat.lat],
        items,
        observationCount,
        bounds,
        highlight,
        // Every dataset under the click, for the card's "add all" action.
        datasetPks: [...new Set(items.map((item) => item.pk))]
      }
    }

    // A tap on a touch screen delivers 'touchend' and then a synthesized
    // 'click' a moment later, and both are wired to this handler. Whichever
    // lands second is the same gesture — drop it, or every tap would build the
    // card twice and the second build would re-open a card the first had just
    // let the user dismiss.
    let lastClickHandledAt = 0
    const TAP_ECHO_MS = 400

    const handleMapClick = (e) => {
      const now = Date.now()
      if (now - lastClickHandledAt < TAP_ECHO_MS) return
      lastClickHandledAt = now

      // Drawing owns the canvas: a click that closes a polygon is not a query.
      // A finished shape lands in direct_select now (see draw.create below),
      // not simple_select — so "done drawing" is just "no longer in a
      // draw_* mode", regardless of which select mode it landed in.
      if (creatingPolygon.current) {
        if (!draw.getMode().includes('draw')) creatingPolygon.current = false
        return
      }
      if (draw.getMode().includes('draw')) return

      const layers = clickLayerIds.filter((id) => map.current.getLayer(id))
      let hits = layers.length
        ? map.current.queryRenderedFeatures(e.point, { layers })
        : []

      // A marker is a specific station; 'coverage-hexes' shares the marker
      // tier's zoom band (both render at z >= hexMaxZoom) and can sit right
      // under it as a neighbourhood aggregate covering the same pixel. The
      // marker is what the user pointed at, so once one is under the click the
      // hex hits are dropped rather than merged into it — a click here always
      // means "this station", never "this station, plus whatever hex happens
      // to be under it".
      const markerHits = hits.filter((feature) => feature.layer.id === 'points')
      if (markerHits.length > 0) {
        hits = hits.filter(
          (feature) => !['hexes', 'coverage-hexes'].includes(feature.layer.id)
        )
      }

      // 'points' carries a wide invisible hit stroke (circle-stroke-width: 10,
      // circle-stroke-opacity: 0.001 — see the layer below) so a marker stays
      // a comfortable target at any zoom. That means one click very commonly
      // registers hits on more than one nearby station, not just the one the
      // cursor is actually over — requiring exactly one hit made almost every
      // click in a cluster fall back to the ambiguous card. Pick whichever
      // station's true position (not its inflated hit area) is closest to the
      // cursor instead; that is unambiguously the one the user pointed at,
      // however many others' hit areas also happened to cover the pixel.
      // Deduped by pk first — the same station can be hit twice where it
      // straddles a tile boundary.
      let nearestMarker = null
      if (markerHits.length > 0) {
        const seenPks = new Set()
        let nearestDistSq = Infinity
        markerHits.forEach((feature) => {
          const pk = feature.properties.pk
          if (seenPks.has(pk)) return
          seenPks.add(pk)
          const projected = map.current.project(feature.geometry.coordinates)
          const dx = projected.x - e.point.x
          const dy = projected.y - e.point.y
          const distSq = dx * dx + dy * dy
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq
            nearestMarker = feature
          }
        })
      }

      // Nothing under the click but (possibly several) markers, and the
      // nearest one names exactly one dataset: unambiguous enough to jump
      // straight to that station's record instead of making the user open a
      // card and click through. A marker's cell naming more than one dataset,
      // or a track/grid sharing the pixel, still falls through to the regular
      // card below, same as before.
      const nonMarkerHits = hits.filter((feature) => feature.layer.id !== 'points')
      if (nearestMarker && nonMarkerHits.length === 0) {
        const markerDatasetPks = datasetPksOf(nearestMarker)
        if (markerDatasetPks.length === 1) {
          popup.remove()
          // This path skips onFeatureQueryRef (see below) — it opens the
          // dataset page directly rather than building a card query — so the
          // usual featureQuery-driven click-highlight effect never runs for
          // it. Ring the clicked marker here instead, the same way
          // buildFeatureQuery would have: same source, same Point-with-count
          // shape, so click-highlight-point sizes the ring to match the
          // marker exactly.
          map.current.getSource('click-highlight')?.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: nearestMarker.geometry,
                properties: { count: Number(nearestMarker.properties.count) || 0 }
              }
            ]
          })
          onMarkerClickRef.current(
            markerDatasetPks[0],
            Number(nearestMarker.properties.pk)
          )
          return
        }
      }

      const query = buildFeatureQuery(e, hits)

      popup.remove()
      onFeatureQueryRef.current(query)

      // Usually redundant with the featureQuery effect below (a real query is
      // always a fresh object, so setFeatureQuery(query) reliably re-triggers
      // it) — needed for the one case that isn't: clicking empty water right
      // after the marker path above, which sets the ring without ever
      // touching featureQuery. If it was already null, React bails out of the
      // no-op setFeatureQuery(null) and that effect never runs, leaving the
      // marker's ring stuck on screen with nothing left for it to point at.
      if (!query) {
        map.current.getSource('click-highlight')?.setData(emptyFeatureCollection)
      }

      // A click on empty water is the way out of everything: it closes the card
      // and drops the spatial selection, which is the only undo a touch user
      // has. It used to be gated behind `defaultPrevented` so that five other
      // handlers could suppress it, and was never bound for touch at all.
      //
      // The getLayer guard matters now that this runs on every click rather than
      // only the ones five other handlers let through: the data layers are added
      // on the map's 'load', and a click before that lands here with nothing
      // under it — setFilter on a layer that doesn't exist yet throws.
      // Only the spatial selection. This used to clear pointsToReview too, from
      // when that meant "the datasets inside the drawn shape"; it is the
      // download selection now — the basket the card's "+" fills and the
      // footer's Download button reads — and it is derived from the `selected`
      // flags on the results, so writing it here both threw away work the user
      // had done and left it disagreeing with the ticked checkboxes in the list
      // until the next refetch.
      if (!query && drawPolygon.current.getAll().features.length === 0) {
        if (map.current.getLayer('points-highlighted')) {
          map.current.setFilter('points-highlighted', ['in', 'pk', ''])
        }
        setPolygon()
      }
    }

    map.current.on('draw.create', (e) => {
      setLoading(true)
      if (drawPolygon.current.getAll().features.length > 1) {
        drawPolygon.current.delete(drawPolygon.current.getAll().features[0].id)
      }
      const feature = drawPolygon.current.getAll().features[0]
      const polygon = feature.geometry.coordinates[0]
      highlightPoints(polygon)
      setPolygon(polygon)
      map.current.getCanvas().style.cursor = 'unset'
      // Straight into direct_select so the shape is immediately draggable
      // (yellow, with handles) rather than sitting in simple_select first.
      // draw.create fires from inside the draw mode's own onStop, which is
      // itself running inside the changeMode() call that's finishing the
      // drawing — calling changeMode again in here would be a reentrant call
      // into that same in-progress transition, so it's deferred a tick.
      setTimeout(() => {
        drawPolygon.current?.changeMode('direct_select', { featureId: feature.id })
      }, 0)
    })

    // Dragging an existing shape (a vertex, or the whole body) in
    // direct_select — see DRAW_UPDATE_DEBOUNCE_MS for why this is debounced.
    const commitDrawUpdate = debounce(() => {
      const feature = drawPolygon.current.getAll().features[0]
      if (!feature) return
      const polygon = feature.geometry.coordinates[0]
      highlightPoints(polygon)
      setPolygon(polygon)
    }, DRAW_UPDATE_DEBOUNCE_MS)
    map.current.on('draw.update', commitDrawUpdate)

    // New tiles — a filter change, or the camera moving into fresh data —
    // arrive as features the focus filters were never computed against (they
    // come from queryRenderedFeatures, a snapshot of whatever was on screen at
    // the time). Re-apply the focus as soon as each data source finishes
    // loading, so the unselected datasets are already grey on the first frame
    // of the new data instead of only after the next hover.
    const dataSourceIds = ['cde-tiles', 'cde-cells']
    map.current.on('sourcedata', (e) => {
      if (!focusedDatasetPk.current) return
      if (!e.isSourceLoaded || !dataSourceIds.includes(e.sourceId)) return
      hoverHighlightPoints(focusedDatasetPk.current)
    })

    map.current.on('idle', (e) => {
      layersLoaded.current = true
      // 'sourcedata' can land before the new tiles have been rendered, and
      // queryRenderedFeatures only sees rendered ones — so settle the focus
      // here too, where everything is guaranteed on screen.
      if (focusedDatasetPk.current) {
        hoverHighlightPoints(focusedDatasetPk.current)
      }
      if (
        doFinalCheck.current &&
        drawPolygon.current.getAll().features.length > 0 &&
        map.current.getZoom() >= 7
      ) {
        setLoading(true)
        highlightPoints(
          drawPolygon.current.getAll().features[0].geometry.coordinates[0]
        )
      }
      doFinalCheck.current = false
      setLoading(false)
    })

    map.current.on('zoomend', (e) => {
      doFinalCheck.current = true
      if (drawPolygon.current.getAll().features.length > 0) {
        if (map.current.getZoom() >= 7) {
          setLoading(true)
          highlightPoints(
            drawPolygon.current.getAll().features[0].geometry.coordinates[0]
          )
        }
      }
    })
    // bounds feeds the "datasets in view" highlight/filter (SelectionProvider);
    // toArray() is [[west,south],[east,north]], the shape boundsIntersect wants.
    const pushMapView = () => {
      const center = map.current.getCenter()
      setMapView({
        lat: center.lat,
        lon: center.lng,
        zoom: map.current.getZoom(),
        bounds: map.current.getBounds().toArray()
      })
    }
    map.current.on('moveend', pushMapView)
    // moveend doesn't fire until the first interaction, so seed bounds once the
    // initial camera settles — otherwise the in-view set is empty until a pan.
    map.current.once('idle', pushMapView)
    map.current.on('mousedown', (e) => {
      if (e.originalEvent.shiftKey) {
        shiftBoxCreate.current = true
        setBoxSelectStartCoords([e.lngLat.lng, e.lngLat.lat])
      }
    })

    map.current.on('mouseup', (e) => {
      if (shiftBoxCreate.current) {
        setBoxSelectEndCoords([e.lngLat.lng, e.lngLat.lat])
        map.current.getCanvas().style.cursor = 'unset'
        shiftBoxCreate.current = false
      }
    })

    // One registration for the whole map. There is no layer fan-out any more, so
    // no repeat deliveries to dedupe and no preventDefault() plumbing between
    // handlers — and the mapbox-gl-draw click-swallowing workaround
    // (https://github.com/mapbox/mapbox-gl-draw/issues/617) that the per-layer
    // touchend bindings existed for goes with it, since the draw modes are
    // checked directly at the top of the handler.
    map.current.on('click', handleMapClick)

    // Touch. A tap has to be told apart from the end of a pan or a pinch, which
    // is why the old code bound 'touchend' per layer and pointedly not
    // map-wide: a map-wide binding fired at the end of every drag and would
    // have cleared the selection each time. Measuring the gesture instead makes
    // the map-wide binding safe, which is what finally gives a touch user the
    // tap-empty-water-to-clear escape hatch they never had.
    const TAP_SLOP_PX = 12
    const TAP_TIMEOUT_MS = 500
    let touchStart = null
    map.current.on('touchstart', (e) => {
      touchStart =
        e.originalEvent.touches.length === 1
          ? { point: e.point, at: Date.now() }
          : null
    })
    map.current.on('touchend', (e) => {
      const start = touchStart
      touchStart = null
      if (!start) return
      if (Date.now() - start.at > TAP_TIMEOUT_MS) return
      const dx = e.point.x - start.point.x
      const dy = e.point.y - start.point.y
      if (dx * dx + dy * dy > TAP_SLOP_PX ** 2) return
      handleMapClick(e)
    })

    // No visible buttons (drawControlOptions.controls) — the draw/box/trash
    // triggers moved into the top bar's spatial filter button, which drives
    // this control via changeMode/deleteAll instead (see the drawRequest
    // effect). Still added to the map so those modes exist to be driven: the
    // scale bar and the attribution ⓘ that used to share this corner moved
    // into the foot of the legend card (see LegendFooter.jsx), and there is no
    // NavigationControl either, since scroll/pinch/double-tap already zoom.
    map.current.addControl(drawPolygon.current, 'bottom-right')
  }, [])

  // Tell the user when the basemap imagery is still on the wire.
  //
  // The four basemap rasters are fetched per view, and a pan or a zoom into
  // ground the map hasn't seen leaves MapLibre showing stretched parent tiles
  // until they land — a blurry map that looks finished. The wait is real:
  // EMODnet and Esri come from their own CDNs, and the two CHS products come
  // through our proxy, which on a cold cache has to fetch from GeoServer before
  // it can answer. Now that the hand-off is a half-zoom swap rather than a
  // two-zoom blend, all of that arrives at once instead of easing in, so the
  // gap is the one moment the map most needs to say it is still working.
  //
  // Deliberately scoped to the basemap sources: the data tiles already have the
  // MapBusy pill, and watching everything would just be map.areTilesLoaded().
  useEffect(() => {
    if (!map.current) return

    const basemapSourceIds = ['bathymetry', 'imagery', 'nonna100', 'nonna10']
    const tilesPending = () =>
      basemapSourceIds.some(
        // A source can be absent mid style-change, and isSourceLoaded throws on
        // an id it doesn't know rather than answering false.
        (id) => map.current.getSource(id) && !map.current.isSourceLoaded(id)
      )

    // Most views resolve from the browser cache within a frame or two, and
    // announcing those would flash the pill on every wheel notch. Only a fetch
    // that outlives this delay is worth telling the user about.
    const ANNOUNCE_AFTER_MS = 300
    // …and the clear is held for a moment too, because tiles arrive in waves:
    // MapLibre requests a screenful, and between one wave landing and the next
    // being requested there are frames where nothing is in flight and the check
    // below reads "done". Acting on those instantly would both flicker the pill
    // and — worse — keep resetting the announce countdown, so a load made of
    // several short waves would never be announced at all however long it ran.
    const SETTLE_MS = 250
    let announceTimer = null
    let settleTimer = null
    let announced = false

    const sync = () => {
      if (tilesPending()) {
        clearTimeout(settleTimer)
        settleTimer = null
        if (announced || announceTimer) return
        announceTimer = setTimeout(() => {
          announceTimer = null
          announced = true
          setBasemapLoading(true)
        }, ANNOUNCE_AFTER_MS)
        return
      }
      // Nothing pending — but see SETTLE_MS. Let the countdown keep running and
      // confirm the quiet is real before acting on it.
      if (settleTimer || (!announced && !announceTimer)) return
      settleTimer = setTimeout(() => {
        settleTimer = null
        if (tilesPending()) return sync()
        clearTimeout(announceTimer)
        announceTimer = null
        if (announced) {
          announced = false
          setBasemapLoading(false)
        }
      }, SETTLE_MS)
    }

    // 'data'/'dataloading' fire per tile for every source on the map, so they
    // are filtered down to the four before the check runs. 'idle' is the
    // backstop: it is the one event guaranteed to arrive once everything has
    // settled, including the cases where a source is dropped rather than loaded
    // (zooming back out past the layers' minzoom).
    const onSourceEvent = (e) => {
      if (e.dataType !== 'source' || !basemapSourceIds.includes(e.sourceId)) {
        return
      }
      sync()
    }
    map.current.on('dataloading', onSourceEvent)
    map.current.on('data', onSourceEvent)
    map.current.on('idle', sync)

    return () => {
      clearTimeout(announceTimer)
      clearTimeout(settleTimer)
      map.current.off('dataloading', onSourceEvent)
      map.current.off('data', onSourceEvent)
      map.current.off('idle', sync)
      if (announced) setBasemapLoading(false)
    }
  }, [setBasemapLoading])

  // The hex color stops depend on the zoom band (getCurrentRangeLevel), but
  // were only applied at load or on legend refresh — so returning below
  // point level left 'hexes' painted with point-level (zoom2) stops, where
  // every hex count clamps past the top stop into a single green. Re-apply
  // on zoomend, re-registering so the handler sees the latest range levels.
  // Declared after the map-creation effect so map.current exists on mount.
  useEffect(() => {
    if (!map.current) return
    const reapplyColorStops = () => setColorStops()
    map.current.on('zoomend', reapplyColorStops)
    return () => map.current.off('zoomend', reapplyColorStops)
  }, [rangeLevels, coverageRangeLevels])

  // Keep the ramp scaled to the hexes actually on screen. Registered once —
  // the handler reads the current setColorStops through a ref — so the
  // debounce survives every re-render and a slow drag really does produce one
  // measurement rather than one per settled frame.
  //
  // Two things can change the hexes on screen: the camera moving over data
  // already loaded, and new tiles arriving (a pan into unloaded ground, a
  // filter change). Both raise the dirty flag; the measurement itself waits for
  // 'idle', which is the one event that means the new features are rendered —
  // 'sourcedata' fires while they are still on their way to the screen, and
  // queryRenderedFeatures only sees what is
  // actually drawn. All three share one debounce, so a pan that pulls in new
  // tiles measures once at the end rather than once per event.
  useEffect(() => {
    if (!map.current) return
    const measure = debounce(
      () => refreshViewportHexRange(),
      VIEWPORT_RAMP_DEBOUNCE_MS
    )
    const onMoveEnd = () => {
      hexRangeDirty.current = true
      measure()
    }
    const onDataSourceLoaded = (e) => {
      if (!e.isSourceLoaded || !HEX_SOURCE_IDS.includes(e.sourceId)) return
      hexRangeDirty.current = true
      measure()
    }
    map.current.on('moveend', onMoveEnd)
    map.current.on('sourcedata', onDataSourceLoaded)
    map.current.on('idle', measure)
    return () => {
      measure.cancel()
      map.current.off('moveend', onMoveEnd)
      map.current.off('sourcedata', onDataSourceLoaded)
      map.current.off('idle', measure)
    }
  }, [])

  // Live-swap basemap label languages on EN⇄FR toggle. The initial language
  // is baked into buildBasemapStyle at construction, so this only fires on
  // runtime changes.
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return
    LABEL_LAYER_IDS.forEach((id) => {
      if (map.current.getLayer(id)) {
        map.current.setLayoutProperty(
          id,
          'text-field',
          getLabelTextField(i18n.language, id)
        )
      }
    })
  }, [i18n.language])

  return <div ref={mapContainer} className='map' />
}
