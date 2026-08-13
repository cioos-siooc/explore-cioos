import * as React from 'react'
import maplibreGl, {
  AttributionControl,
  Popup,
  ScaleControl
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import { useState, useEffect, useRef } from 'react'

import * as helpers from '@turf/helpers'
import turfBboxPolygon from '@turf/bbox-polygon'
import turfPointsWithinPolygon from '@turf/points-within-polygon'
import turfBbox from '@turf/bbox'

import DrawRectangle from 'mapbox-gl-draw-rectangle-mode'
import debounce from 'lodash/debounce'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import './styles.css'

import { server } from '../../config'
import {
  boundsFromGeoJson,
  escapeHtml,
  generateColorStops,
  getCurrentRangeLevel,
  selectionFromSearchParams,
  updateMapToolTitleLanguage,
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
  colorScale,
  hexOutlineColor,
  API_DEFAULT_HEX_METRIC,
  DEFAULT_HEX_METRIC,
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
function buildTileSuffix(baseQuery, dataLayers, metric = DEFAULT_HEX_METRIC) {
  const params = new URLSearchParams(baseQuery)
  // Omitted only for the metric the API already assumes when the param is
  // absent — see API_DEFAULT_HEX_METRIC.
  if (metric !== API_DEFAULT_HEX_METRIC) params.set('metric', metric)
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
  setPointsToReview,
  polygon,
  setPolygon,
  setLoading,
  setBasemapLoading = () => {},
  setMapView,
  offsetFlyTo,
  rangeLevels,
  coverageRangeLevels,
  metric = DEFAULT_HEX_METRIC,
  hoveredDataset,
  setHoveredDataset,
  inspectDataset,
  setDatasetsSelected,
  tracksMode,
  scrubTime,
  trailingDays,
  selectedTrajectory,
  selectTrajectoryFromMap,
  dataLayers,
  griddapCoverage,
  dataLayersVisible = true,
  bathymetryVisible = true,
  activeWmsOverlay,
  projection = 'mercator',
  zoomTarget,
  mapRef
}) {
  const { t, i18n } = useTranslation()

  const [searchParams] = useSearchParams()

  const mapContainer = useRef(null)
  const map = useRef(null)
  const creatingPolygon = useRef(false)
  const shiftBoxCreate = useRef(false)

  // disables edting of polygon/box vertices
  const disabledEvent = function (state, geojson, display) {
    display(geojson)
  }

  const modes = MapboxDraw.modes
  MapboxDraw.modes.direct_select.toDisplayFeatures = disabledEvent
  MapboxDraw.modes.simple_select.toDisplayFeatures = disabledEvent

  modes.draw_rectangle = DrawRectangle

  const drawControlOptions = {
    displayControlsDefault: false,
    controls: {
      point: false,
      line_string: false,
      polygon: true,
      trash: true,
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
  // Shared with MapStateProvider (which pins the metric above this zoom) and
  // the Legend (which switches its key here): the hex band ending and the
  // marker tier starting are the same boundary, and they must not drift.
  const hexMaxZoom = MARKER_MIN_ZOOM
  // Zoom at which griddap coverage rectangles take hover/click priority over
  // the hex aggregates (which stop being drawn at hexMaxZoom anyway).
  const griddapPriorityZoom = 5
  // 0.55 at the z7 hand-off (where trajectory and OBIS counts stop being
  // merged into the green hexes layer), fading to a light coverage wash by z10
  // so the point circles stay readable over dense coverage areas.
  const coverageHexOpacity = [
    'interpolate',
    ['linear'],
    ['zoom'],
    hexMaxZoom,
    0.55,
    hexMaxZoom + 1.5,
    0.3,
    hexMaxZoom + 3,
    0.15
  ]

  const draw = new MapboxDraw(drawControlOptions)
  const drawPolygon = useRef(draw)
  const doFinalCheck = useRef(false)
  const layersLoaded = useRef(false)
  const colorStops = useRef([])
  const coverageColorStops = useRef([])
  // Point-tier count range, kept so the circle-radius ramp can be rebuilt on
  // the layers whenever the metric or the filters change (see setColorStops).
  const pointRadiusRange = useRef(null)
  // pk of the dataset the map is currently singling out (hovered in the list,
  // or the one whose page is open). Held in a ref because the map's own event
  // handlers — zoomend, sourcedata, idle — need the current value, not the one
  // captured when they were registered.
  const focusedDatasetPk = useRef(undefined)
  // Signature of the focus state last written to the map, so re-applying an
  // unchanged focus costs nothing (see hoverHighlightPoints).
  const appliedFocus = useRef('')
  // Latest tracks-mode props for the one-shot map 'load' closure (layers are
  // created once; these refs let it apply the current mode/scrub window).
  const tracksModeRef = useRef(tracksMode)
  const scrubTimeRef = useRef(scrubTime)
  const trailingDaysRef = useRef(trailingDays)
  const dataLayersRef = useRef(dataLayers)
  const metricRef = useRef(metric)
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
  const defaultRangeLevels = { zoom0: [1, 100], zoom1: [1, 100], zoom2: [1, 100] }
  const defaultCoverageRangeLevels = { zoom1: [1, 100] }

  const [boxSelectStartCoords, setBoxSelectStartCoords] = useState()
  const [boxSelectEndCoords, setBoxSelectEndCoords] = useState()

  const popup = new Popup({
    closeButton: false,
    closeOnClick: true,
    maxWidth: '400px'
  })

  // Stays open (unlike the hover popup) so a dataset can be picked out of a
  // stack of overlapping coverage rectangles.
  const griddapPicker = new Popup({
    closeButton: true,
    closeOnClick: false,
    className: 'griddap-picker-popup',
    maxWidth: '380px'
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

  useEffect(() => {
    setColorStops()
  }, [rangeLevels, coverageRangeLevels])

  useEffect(() => {
    if (map.current) {
      map.current.offsetFlyTo = offsetFlyTo
    }
  }, [offsetFlyTo])

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
    setPointsToReview()
    setPolygon()
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

  // Hover wording has to follow the metric: the same `count` property is a
  // measurement count in one mode and a day span in the other, and a tooltip
  // that says "measurements" over a day count is worse than no tooltip.
  // Numbers are locale-formatted — a bare 1738204 is unreadable at a glance.
  // Note the interpolation variable is `total`, not `count`: i18next treats a
  // numeric `count` option as a pluralization trigger and would go looking for
  // _one/_other variants that don't exist.
  const metricCountLabel = (value) =>
    t(
      {
        days: 'mapHexCountDays',
        datasets: 'mapHexCountDatasets'
      }[metricRef.current] || 'mapHexCountRecords',
      { total: Number(value || 0).toLocaleString(i18n.language) }
    )

  // Point markers size by the same metric the hexes colour by, log-spaced over
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

  // The four layers that draw the same point features, and the halo's extra
  // radius. They share one paint, so a radius change has to reach all of them
  // or the halo/highlight desync from the markers they sit under.
  const POINT_LAYERS = [
    ['points', 0],
    ['points-halo', 1.25],
    ['points-highlighted', 0],
    ['points-hovered', 0]
  ]
  // Coverage hexes ramp on their own domain (coverageColorStops) rather than
  // the main one: they cover a different population of hexes, and sharing the
  // main tier's min/max flattened them.
  const coverageHexFillColor = () =>
    rampExpression(coverageColorStops.current, 'count')

  // A fixed outline, so a coverage hex still reads as a discrete cell where the
  // fill is nearly transparent (the layer fades out with zoom).
  const coverageHexOutlineColor = () => hexOutlineColor

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
    colorStops.current = generateColorStops(
      colorScale,
      getCurrentRangeLevel(effectiveRangeLevels, map.current.getZoom())
    ).map((colorStop) => {
      return [colorStop.stop, colorStop.color]
    })

    // Coverage hexes only ever render at zoom >= hexMaxZoom, where the hex_1
    // grid is always used, so there's a single range to apply.
    const effectiveCoverageRangeLevels =
      coverageRangeLevels || defaultCoverageRangeLevels
    coverageColorStops.current = generateColorStops(
      colorScale,
      effectiveCoverageRangeLevels.zoom1
    ).map((colorStop) => {
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
    }
  }

  function hoverHighlightPoints(pk) {
    if (!map.current || !layersLoaded.current) return

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
        .filter(
          (feature) => !JSON.parse(feature.properties.datasets).includes(pk)
        )
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

  function griddapFeaturesAt(point) {
    return dedupeGriddapByPk(
      map.current.queryRenderedFeatures(point, {
        layers: ['griddap-coverage-fill']
      })
    )
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
  // pins the same highlight hovering gives, until it's closed.
  useEffect(() => {
    if (map.current) {
      const focusedDataset = hoveredDataset || inspectDataset
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
      if (map.current.offsetFlyTo === undefined) {
        map.current.offsetFlyTo = true
      }
    }
  }

  // Latest map query, readable from the map 'load' closure (which would
  // otherwise build its tile URLs from the query as of the first render).
  const mapQueryRef = useRef(mapQueryString)
  mapQueryRef.current = mapQueryString

  // Track clicks are served by a listener registered once, in the map-creation
  // effect; the action it calls is rebuilt whenever the results change, so read
  // it through a ref rather than freezing the first render's copy.
  const selectTrajectoryFromMapRef = useRef(selectTrajectoryFromMap)
  selectTrajectoryFromMapRef.current = selectTrajectoryFromMap

  // Whether hovering this trajectory would offer anything on click, for the
  // tooltip hint: its full track is already drawn once it is the selection.
  const selectedTrajectoryRef = useRef(selectedTrajectory)
  selectedTrajectoryRef.current = selectedTrajectory
  const trackClickHint = (properties) =>
    selectedTrajectoryRef.current?.trajectoryId === properties.trajectory_id &&
    selectedTrajectoryRef.current?.datasetPk === Number(properties.pk_url)
      ? ''
      : `<div class='map-tooltip-hint'>${t('trackLineClickText')}</div>`

  // The filter query and the data-layer selection combine into one suffix
  // shared by both source URLs — see buildTileSuffix. The two routes split the
  // zoom range for the same selection: /tiles folds the trajectory counts into
  // the combined green hexes below z7, /tiles/cells carries the dedicated
  // trajectory/OBIS coverage ramp at and above it. They take the same params so
  // the hex switch can't leave trajectory counts showing in one and not the other.
  const tileUrls = (queryString) => {
    const filterSuffix = buildTileSuffix(
      queryString,
      dataLayersRef.current,
      metricRef.current
    )
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

    setPointsToReview()
    map.current.setFilter('points-highlighted', ['in', 'pk', ''])

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
    refreshCombinedSources(mapQueryString)
    if (tracksModeRef.current && anyTrajectoryLayerOn(dataLayers)) {
      refreshTracksSource(mapQueryString, scrubTimeRef.current, trailingDaysRef.current)
    }
    applyLayerVisibility()
  }, [dataLayers])

  // Colour-by switch. The metric is computed server-side (it decides what the
  // tiles' `count` property sums), so flipping it has to refetch both sources
  // — repainting alone would ramp the old numbers against the new domain. The
  // matching /legend refetch happens in MapStateProvider; setColorStops picks
  // up the new ranges from the [rangeLevels] effect.
  useEffect(() => {
    metricRef.current = metric
    if (!map.current || !map.current.getSource('cde-tiles')) return
    refreshCombinedSources(mapQueryString)
  }, [metric])

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
        if (map.current.getLayer('track-lines')) {
          map.current.setPaintProperty('track-lines', 'line-color', trackLineColor)
          map.current.setLayoutProperty('track-heads', 'icon-image', 'track-head-arrow')
          map.current.setPaintProperty('track-heads-fixed', 'circle-color', trackLineColor)
        }
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
          if (error.name !== 'AbortError') {
            console.error('track fetch failed:', error)
          }
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

      if (map.current.getLayer('track-lines')) {
        map.current.setPaintProperty('track-lines', 'line-color', 'lightgrey')
        map.current.setLayoutProperty('track-heads', 'icon-image', 'track-head-arrow-dim')
        map.current.setPaintProperty('track-heads-fixed', 'circle-color', 'lightgrey')
      }

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
      // Per-source attributions replace the default control (see the compact
      // AttributionControl added below).
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

    // clone an element to remove it's events
    function cloneElement(oldElement) {
      const newElement = oldElement.cloneNode(true)
      oldElement.parentNode.replaceChild(newElement, oldElement)
      return newElement
    }

    map.current.on('load', () => {
      const boxQueryElement = document.getElementById('boxQueryButton')
      const trashQueryElement = cloneElement(
        document.getElementsByClassName('mapbox-gl-draw_trash').item(0)
      )
      const polyQueryElement = cloneElement(
        document.getElementsByClassName('mapbox-gl-draw_polygon').item(0)
      )

      // Portaled in by MapCornerControls; guard so a mount-order surprise
      // can't break the rest of map init.
      if (boxQueryElement) {
        boxQueryElement.onclick = (e) => {
          map.current.getCanvas().style.cursor = 'crosshair'
          deleteAllShapes()
          creatingPolygon.current = true
          drawPolygon.current.changeMode('draw_rectangle')
          return false
        }
      }
      
      polyQueryElement.onclick = (e) => {
        map.current.getCanvas().style.cursor = 'crosshair'
        deleteAllShapes()
        creatingPolygon.current = true
        drawPolygon.current.changeMode('draw_polygon')
        return false
      }

      trashQueryElement.onclick = () => {
        endDrawing()
        return false
      }

      function endDrawing() {
        map.current.getCanvas().style.cursor = 'unset'
        drawPolygon.current.changeMode('simple_select')
        deleteAllShapes()
      }

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
            'fill-opacity': coverageHexOpacity,
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
            'circle-opacity': 0.9,
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
          'fill-opacity': hexOpacity,
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
        drawPolygon.current.add({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [sharedSelection] }
        })
        highlightPoints(sharedSelection)
      }
    })

    const handleMapOnClick = (e) => {
      // Clear highlighted points if looking at points level and clicking off of the points
      if (
        drawPolygon.current.getAll().features.length === 0 &&
        !e.originalEvent.defaultPrevented
      ) {
        map.current.setFilter('points-highlighted', ['in', 'pk', ''])
        setPointsToReview()
        setPolygon()
      }
    }

    const handleMapPointsOnClick = (e) => {
      // A track wins the ring between a point's visible circle and the invisible
      // 10px hit halo around it (see isOnAPoint): the click was aimed at the
      // track, and the rectangle selection below would refilter the results and
      // close the dataset page the track selection just opened. Inside the
      // visible circle the point still wins — the track handler stands aside
      // there — so this is the same hand-off from the other side.
      if (!isOnAPoint(e) && trackFeatureAt(e.point)) return
      e.originalEvent.preventDefault()
      if (!creatingPolygon.current) {
        drawPolygon.current?.deleteAll()

        if (map.current.offsetFlyTo === undefined) {
          map.current.offsetFlyTo = true
        }
        map.current.flyTo({
          center: [e.lngLat.lng, e.lngLat.lat],
          padding: map.current.offsetFlyTo
            ? { top: 0, bottom: 0, left: 500, right: 0 }
            : { top: 0, bottom: 0, left: 0, right: 0 }
        })
        const height = 20
        const width = 20
        const bbox = [
          [e.point.x - width / 2, e.point.y - height / 2],
          [e.point.x + width / 2, e.point.y + height / 2]
        ]
        const cornerA = map.current.unproject(bbox[0])
        const cornerB = map.current.unproject(bbox[1])
        const clickLngLatBBox = [
          [cornerA.lng, cornerA.lat],
          [cornerB.lng, cornerB.lat]
        ]
        const lineString = helpers.lineString(clickLngLatBBox)
        const bboxPolygon = turfBboxPolygon(turfBbox(lineString))
        highlightPoints(bboxPolygon.geometry.coordinates[0])
        setPolygon(bboxPolygon.geometry.coordinates[0])
      } else if (
        draw.getMode() === 'simple_select' &&
        creatingPolygon.current
      ) {
        creatingPolygon.current = false
      }
    }

    const handleMapHexesOnClick = (e) => {
      // A track under the cursor wins: a hex sits under a track line whenever
      // the hex layers are drawn (the trajectory hexes if that switch is on,
      // otherwise a profile or OBIS hex), and this handler's zoom-to-7 flyTo
      // would fight the fit the track selection is about to do.
      if (griddapOutranksHexes(e) || trackFeatureAt(e.point)) return
      e.originalEvent.preventDefault()
      if (!creatingPolygon.current) {
        map.current.flyTo({
          center: [e.lngLat.lng, e.lngLat.lat],
          zoom: 7,
          padding: map.current.offsetFlyTo
            ? { top: 0, bottom: 0, left: 500, right: 0 }
            : { top: 0, bottom: 0, left: 0, right: 0 }
        })
      } else if (
        draw.getMode() === 'simple_select' &&
        creatingPolygon.current
      ) {
        creatingPolygon.current = false
      }
    }

    const handleMapCoverageHexesOnClick = (e) => {
      e.originalEvent.preventDefault()
      // 'points' renders on top of 'coverage-hexes' at the same zoom
      // range — let its own click handler manage the click when the
      // cursor is directly over a point. A track line under the cursor stands
      // aside for the same reason: narrowing the selection to this hex's
      // datasets would refilter the tracks tiles and erase the clicked track.
      if (
        map.current.queryRenderedFeatures(e.point, { layers: ['points'] })
          .length > 0 ||
        trackFeatureAt(e.point)
      ) {
        return
      }
      if (!creatingPolygon.current) {
        const hexFeature = e.features[0]
        const cellDatasetPks = JSON.parse(hexFeature.properties.datasets)

        // Profile datasets don't have their own hex feature at this zoom —
        // they render as individual 'points' — so pull in whichever of those
        // currently-rendered points fall inside this hex's boundary too.
        const pointFeatures = map.current
          .queryRenderedFeatures({ layers: ['points'] })
          .map((point) => ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: point.geometry.coordinates
            },
            properties: { ...point.properties }
          }))
        const pointsWithinHex = turfPointsWithinPolygon(
          { type: 'FeatureCollection', features: pointFeatures },
          hexFeature
        )
        const pointDatasetPks = pointsWithinHex.features.flatMap((feature) =>
          JSON.parse(feature.properties.datasets)
        )

        const hexDatasetPks = new Set([...cellDatasetPks, ...pointDatasetPks])
        setDatasetsSelected((previousDatasetsSelected) =>
          previousDatasetsSelected.map((dataset) => ({
            ...dataset,
            isSelected: hexDatasetPks.has(dataset.pk)
          }))
        )
      } else if (
        draw.getMode() === 'simple_select' &&
        creatingPolygon.current
      ) {
        creatingPolygon.current = false
      }
    }

    // Clickable track layers, most-deliberate target first: an arrowhead is
    // aimed at (it is what the head tooltip describes), the line is the fallback.
    const trackClickLayers = ['track-heads', 'track-heads-fixed', 'track-lines']

    // The selected platform's own drawing, which sits over the tile layers.
    const selectedTrackLayers = [
      'selected-track-fixes',
      'selected-track-fixes-nocog',
      'selected-track-line'
    ]

    const renderedFeatures = (point, layerIds) => {
      const layers = layerIds.filter((id) => map.current.getLayer(id))
      return layers.length === 0
        ? []
        : map.current.queryRenderedFeatures(point, { layers })
    }

    // 'points' carries an invisible 10px hit stroke so small circles stay easy
    // to hit (see its paint), but that halo is 2-4x the circle actually drawn —
    // standing aside for all of it would leave track lines unclickable at z7+
    // (where points appear) anywhere profiles are dense, which is most of the
    // coast. A track yields only to the circle the user can see, plus a pixel
    // or two of grace.
    // These precedence tests come in pairs: an `…In` form that reads an
    // already-queried set of features, and a wrapper that queries for it. The
    // hover path runs one query per frame and uses the `…In` forms throughout
    // (see the dispatcher below); the click handlers, which fire rarely enough
    // for it not to matter, keep querying per test.
    const POINT_HIT_GRACE_PX = 2
    const isOnAPointIn = (hits, point) =>
      hits
        .filter((feature) => feature.layer.id === 'points')
        .some((feature) => {
          const centre = map.current.project(feature.geometry.coordinates)
          const radius =
            (feature.properties.count <= 2 ? smallCircleSize : largeCircleSize) +
            POINT_HIT_GRACE_PX
          return (
            (centre.x - point.x) ** 2 + (centre.y - point.y) ** 2 <= radius ** 2
          )
        })
    const isOnAPoint = (e) =>
      isOnAPointIn(renderedFeatures(e.point, ['points']), e.point)

    // The track feature under a point, ranked by trackClickLayers rather than by
    // render order, so a head from one trajectory and a line from another under
    // the same cursor resolve the same way every time (the hover dispatcher
    // makes the same hand-off). Doubles as the "is a track under the
    // cursor" test the hex and griddap handlers use to stand aside: hidden
    // layers aren't hit-testable, so this is empty whenever the track-lines
    // switch is off and no tracksMode check is needed.
    const trackFeatureIn = (hits) =>
      hits
        .filter((feature) => trackClickLayers.includes(feature.layer.id))
        .sort(
          (a, b) =>
            trackClickLayers.indexOf(a.layer.id) -
            trackClickLayers.indexOf(b.layer.id)
        )[0]
    const trackFeatureAt = (point) =>
      trackFeatureIn(renderedFeatures(point, trackClickLayers))

    // One listener per track layer means a click on a head arrow sitting on its
    // own line delivers the same DOM event twice. Both deliveries land before
    // React commits the first selection, so both would see a stale
    // selectedTrajectory and push their own history entry — dedupe on the DOM
    // event (MapLibre passes the same one to every delegated listener).
    let lastHandledTrackEvent = null

    // Clicking a track draws that platform's full history, exactly as clicking
    // its row in the dataset inspector's platform table does.
    const handleTrackOnClick = (e) => {
      // Individual points stay the precise target at every zoom — the rule
      // handleMapCoverageHexesOnClick and griddapFeatureIsCovered already follow.
      if (isOnAPoint(e)) return

      // The selected platform's track owns the pixels it covers: its fixes and
      // line are drawn over the tile layers and its tooltip deliberately offers
      // no click hint, so clicking it does nothing rather than pick whichever
      // neighbouring track runs underneath. Datasets that split into many
      // near-coincident short trajectories make that a real hazard — clicking
      // the track you just selected would swap it for its neighbour.
      const onSelectedTrack =
        renderedFeatures(e.point, selectedTrackLayers).length > 0
      const feature = onSelectedTrack ? undefined : trackFeatureAt(e.point)
      if (!onSelectedTrack && !feature) return
      // Keeps handleMapOnClick from reading this as a click on empty water and
      // clearing the highlighted points, the review list and the drawn polygon.
      e.originalEvent.preventDefault()
      if (creatingPolygon.current) {
        if (draw.getMode() === 'simple_select') creatingPolygon.current = false
        return
      }
      if (onSelectedTrack) return
      if (e.originalEvent === lastHandledTrackEvent) return
      lastHandledTrackEvent = e.originalEvent
      const {
        pk_url: datasetPk,
        trajectory_id: trajectoryId,
        dataset_title: datasetTitle
      } = feature.properties
      // trajectory_id is '' for a dataset with a single unnamed trajectory
      // (the schema default) and that is a valid selection end to end, so test
      // for absence rather than falsiness.
      if (datasetPk == null || trajectoryId == null) return
      popup.remove()
      selectTrajectoryFromMapRef.current?.(
        Number(datasetPk),
        trajectoryId,
        datasetTitle
      )
    }

    // Griddap coverage rectangles normally defer to the point/hex layers, so a
    // click meant for an observation isn't swallowed by the grid drawn over it
    // (same pattern as coverage-hexes above). Past griddapPriorityZoom the
    // rectangles outrank the hex aggregates instead: the hexes are a coarse
    // backdrop by then, and someone zoomed in that far is working with a
    // specific grid. Individual points stay precise targets at every zoom, and
    // so do track lines: a thin line someone aimed at outranks a backdrop
    // rectangle, and letting the rectangle win would narrow the filters to its
    // one dataset and erase the clicked track.
    const griddapFeatureIsCovered = (e) =>
      map.current.queryRenderedFeatures(e.point, {
        layers: (map.current.getZoom() >= griddapPriorityZoom
          ? ['points']
          : ['points', 'hexes']
        ).filter((layer) => map.current.getLayer(layer))
      }).length > 0 || Boolean(trackFeatureAt(e.point))

    // The other side of that hand-off: a hex hover/click stands aside once the
    // rectangles have priority, otherwise both handlers fire on the same event
    // and the hex's zoom-in fights the rectangle's dataset selection.
    const griddapOutranksHexes = (e) =>
      map.current.getZoom() >= griddapPriorityZoom &&
      map.current.getLayer('griddap-coverage-fill') &&
      map.current.queryRenderedFeatures(e.point, {
        layers: ['griddap-coverage-fill']
      }).length > 0

    // The same two tests against an already-queried set, for the hover
    // dispatcher (see the `…In` pairs above).
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
      // A dozen bilingual titles would fill the map, so the tooltip previews a
      // few (each clamped to two lines) and the picker (on click) lists the rest.
      const previewed = features.slice(0, 3)
      const titles = previewed
        .map(
          (feature) =>
            `<div class="griddap-tooltip-item">${escapeHtml(griddapTitle(feature))}</div>`
        )
        .join('')
      const remaining = features.length - previewed.length
      const hint =
        features.length > 1
          ? t('griddapCoverageStackTooltip', { n: features.length })
          : t('griddapCoverageTooltip')
      const more = remaining
        ? `<div class="griddap-tooltip-more">${t('griddapCoverageMore', {
          n: remaining
        })}</div>`
        : ''
      popup
        .setHTML(
          `<div class="griddap-tooltip">${titles}${more}<div class="griddap-tooltip-hint">${hint}</div></div>`
        )
        .addTo(map.current)
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
        show: (e, features) => {
          const properties = features[0].properties
          const fixDate = properties.time
            ? properties.time.replace('T', ' ').slice(0, 16)
            : ''
          popup
            .setLngLat([e.lngLat.lng, e.lngLat.lat])
            .setHTML(
              `<div>${properties.dataset_title ? `<b>${escapeHtml(properties.dataset_title)}</b><br/>` : ''}${escapeHtml(properties.trajectory_id)}${fixDate ? `<br/>${fixDate}` : ''}</div>`
            )
            .addTo(map.current)
        }
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
        show: (e, features) => {
          const properties = features[0].properties
          popup
            .setLngLat([e.lngLat.lng, e.lngLat.lat])
            .setHTML(
              `<div>${properties.dataset_title ? `<b>${escapeHtml(properties.dataset_title)}</b><br/>` : ''}${escapeHtml(properties.trajectory_id)}${trackClickHint(properties)}</div>`
            )
            .addTo(map.current)
        }
      },
      {
        id: 'track-heads',
        layers: ['track-heads', 'track-heads-fixed'],
        when: (hits, point) => !isOnAPointIn(hits, point),
        show: (e, features) => {
          const properties = features[0].properties
          const headDate = properties.head_time
            ? new Date(Number(properties.head_time)).toISOString().replace('T', ' ').slice(0, 16)
            : ''
          popup
            .setLngLat([e.lngLat.lng, e.lngLat.lat])
            .setHTML(
              `<div>${properties.dataset_title ? `<b>${escapeHtml(properties.dataset_title)}</b><br/>` : ''}${escapeHtml(properties.trajectory_id)}${headDate ? `<br/>${headDate}` : ''}${trackClickHint(properties)}</div>`
            )
            .addTo(map.current)
        }
      },
      {
        id: 'points',
        layers: ['points'],
        show: (e, features) => {
          popup
            // the circle's own centre, not the cursor, so the tooltip sits on
            // the point it describes
            .setLngLat(features[0].geometry.coordinates.slice())
            // metricCountLabel, not a fixed noun: `count` is measurements,
            // days or datasets depending on the metric.
            .setHTML(
              `<div>${metricCountLabel(
                features[0].properties.count
              )}. ${t('mapClickForDetails')}</div>`
            )
            .addTo(map.current)
        }
      },
      {
        id: 'coverage-hexes',
        layers: ['coverage-hexes'],
        when: (hits) => !hits.some((feature) => feature.layer.id === 'points'),
        show: (e, features) => {
          const {
            count,
            trajectory_count: trajectories,
            obis_count: occurrences
          } = features[0].properties

          // The ramp folds trajectory and OBIS coverage into one colour, so this
          // is the only place the two are still told apart. Lead with the total
          // (what the colour shows), then name what's actually in the hex — a
          // trajectory fix and an occurrence record are summed above but they
          // aren't the same unit, and this is where that stays visible.
          const breakdown = []
          if (trajectories > 0) {
            // Distinct missions/deployments — the one figure here that doesn't
            // change with the metric.
            breakdown.push(
              t('mapCoverageTrajectories', {
                trajectories: Number(trajectories).toLocaleString(i18n.language)
              })
            )
          }
          if (occurrences > 0) {
            // obis_count carries the same metric as `count`, so its noun has to
            // follow suit — "occurrence records" over a day span would be wrong.
            breakdown.push(
              t(
                {
                  days: 'mapCoverageObisDays',
                  datasets: 'mapCoverageObisDatasets'
                }[metricRef.current] || 'mapCoverageObisRecords',
                { total: Number(occurrences).toLocaleString(i18n.language) }
              )
            )
          }

          popup
            .setLngLat([e.lngLat.lng, e.lngLat.lat])
            .setHTML(
              `<div>${metricCountLabel(count)}. ${t('mapClickToZoom')}</div>` +
                (breakdown.length
                  ? `<div class='map-tooltip-hint'>${breakdown.join(' · ')}</div>`
                  : '')
            )
            .addTo(map.current)
        }
      },
      {
        id: 'hexes',
        layers: ['hexes'],
        when: (hits) => !griddapOutranksHexesIn(hits),
        show: (e, features) => {
          popup
            .setLngLat([e.lngLat.lng, e.lngLat.lat])
            .setHTML(
              `<div>${metricCountLabel(
                features[0].properties.count
              )}. ${t('mapClickToZoom')}</div>`
            )
            .addTo(map.current)
        }
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

    // Same mechanism as the trajectory-hex click: narrow the dataset selection
    // to one dataset, which makes /pointQuery return one row and
    // SelectionDetails auto-open its inspector.
    const selectGriddapDataset = (pk) =>
      setDatasetsSelected((previousDatasetsSelected) =>
        previousDatasetsSelected.map((dataset) => ({
          ...dataset,
          isSelected: dataset.pk === pk
        }))
      )

    // Overlapping rectangles can't be told apart by clicking, so a stack opens
    // a picker listing every dataset under the click instead of silently
    // selecting the topmost one.
    const openGriddapPicker = (lngLat, features) => {
      const picker = document.createElement('div')
      picker.className = 'griddap-picker'
      const heading = document.createElement('div')
      heading.className = 'griddap-picker-heading'
      heading.textContent = t('griddapCoveragePickerTitle', {
        n: features.length
      })
      // The heading sits outside the scroller so it stays put while a long
      // stack scrolls.
      const list = document.createElement('div')
      list.className = 'griddap-picker-list'
      picker.append(heading, list)
      features.forEach((feature) => {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'griddap-picker-item'
        const title = griddapTitle(feature)
        // The title lives in its own element because Chromium won't line-clamp
        // a button's own box. The full title stays reachable as the native
        // tooltip.
        const label = document.createElement('span')
        label.className = 'griddap-picker-item-title'
        label.textContent = title
        card.appendChild(label)
        card.title = title
        card.addEventListener('mouseenter', () => setGriddapHovered([feature]))
        card.addEventListener('click', () => {
          selectGriddapDataset(feature.properties.pk)
          griddapPicker.remove()
        })
        list.appendChild(card)
      })
      griddapPicker.setLngLat(lngLat).setDOMContent(picker).addTo(map.current)
    }

    griddapPicker.on('close', () => setGriddapHovered([]))

    const handleGriddapCoverageOnClick = (e) => {
      if (griddapFeatureIsCovered(e)) return
      e.originalEvent.preventDefault()
      if (!creatingPolygon.current) {
        const features = griddapFeaturesAt(e.point)
        if (features.length > 1) {
          popup.remove()
          openGriddapPicker(e.lngLat, features)
        } else if (features.length === 1) {
          selectGriddapDataset(features[0].properties.pk)
        }
      } else if (
        draw.getMode() === 'simple_select' &&
        creatingPolygon.current
      ) {
        creatingPolygon.current = false
      }
    }

    map.current.on('draw.create', (e) => {
      setPointsToReview()
      setLoading(true)
      if (drawPolygon.current.getAll().features.length > 1) {
        drawPolygon.current.delete(drawPolygon.current.getAll().features[0].id)
      }
      const polygon =
        drawPolygon.current.getAll().features[0].geometry.coordinates[0]
      highlightPoints(polygon)
      setPolygon(polygon)
      map.current.getCanvas().style.cursor = 'unset'
      // creatingPolygon.current = false
      // if(!polygonIsRectangle(polygon)){
      //   // set className of polygon button to active
      //   const polygonCreateButton = document.getElementsByClassName('mapbox-gl-draw_ctrl-draw-btn mapbox-gl-draw_polygon')
      //   polygonCreateButton.setProperty('background-colour', '#c6e3df')
      // }
    })

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
        setPointsToReview()
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

    // Workaround for https://github.com/mapbox/mapbox-gl-draw/issues/617
    map.current.on('click', 'points', handleMapPointsOnClick)
    map.current.on('touchend', 'points', handleMapPointsOnClick)

    map.current.on('click', 'hexes', handleMapHexesOnClick)
    map.current.on('touchend', 'hexes', handleMapHexesOnClick)

    map.current.on('click', 'coverage-hexes', handleMapCoverageHexesOnClick)
    map.current.on('touchend', 'coverage-hexes', handleMapCoverageHexesOnClick)

    map.current.on('click', 'griddap-coverage-fill', handleGriddapCoverageOnClick)
    map.current.on('touchend', 'griddap-coverage-fill', handleGriddapCoverageOnClick)

    // Registered before the map-wide handler below: MapLibre dispatches click
    // listeners in registration order and mutates the one event object, which is
    // what makes this handler's preventDefault() visible there. The handler
    // itself dedupes the repeat deliveries this fan-out causes.
    // The selected track's own layers are included so a click along it is
    // absorbed there too, instead of falling through to the map-wide handler.
    ;[...trackClickLayers, ...selectedTrackLayers].forEach((layerId) => {
      map.current.on('click', layerId, handleTrackOnClick)
      map.current.on('touchend', layerId, handleTrackOnClick)
    })

    map.current.on('click', handleMapOnClick)
    // mobile seems better without handleMapOnClick enabled for touch

    const scale = new ScaleControl({
      maxWidth: 150,
      unit: 'metric'
    })

    // Aggregates the per-source attributions from the basemap style
    // (EMODnet bathymetry, Esri imagery, OpenFreeMap vector).
    const attribution = new AttributionControl({
      compact: true
    })
    map.current.addControl(attribution, 'bottom-right')
    // Start the attribution closed, as the bare ⓘ bubble, instead of with the
    // credits line spread across the corner of the map.
    //
    // MapLibre expands compact attribution itself, and not at mount: on mount
    // the control is still `maplibregl-attrib-empty` (the style's attributions
    // haven't arrived), which makes its _updateCompact a no-op — so is clearing
    // the expanded class here. The expansion lands later, when the attributions
    // resolve and _updateCompact runs again on an element carrying neither
    // class, at which point it adds `maplibregl-compact` *and*
    // `maplibregl-compact-show`. Adding the compact class ourselves now is what
    // holds: that branch is guarded on the class being absent, so it stops
    // running while the ⓘ toggle, which only needs the same class, keeps
    // working.
    mapContainer.current
      ?.querySelector('.maplibregl-ctrl-attrib')
      ?.classList.add('maplibregl-compact')
    map.current.addControl(scale, 'bottom-right')

    // Called order determines stacking order. No NavigationControl: the +/-
    // zoom buttons only repeated what scroll, pinch and double-tap already do,
    // and the corner is busy enough with the draw tools.
    map.current.addControl(drawPolygon.current, 'bottom-right')

    updateMapToolTitleLanguage(t)
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
