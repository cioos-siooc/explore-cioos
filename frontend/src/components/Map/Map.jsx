import * as React from 'react'
import maplibreGl, {
  AttributionControl,
  NavigationControl,
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
  trajectoryColorScale,
  obisColorScale,
  mixedColorScale,
  trackLineColor,
  selectedTrackColor,
  tracksMinDate,
  TRAIL_ALL
} from '../config'
import platformColors from '../../components/platformColors'
import { PROFILE_TYPE_KEYS } from '../../state/dataLayers.js'
import {
  applyBasemap,
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

// Combine the filter-derived query string with the data-layer selection into
// a tile-URL suffix. OBIS off adds includeObis=false, OR-ed with any the
// Source filter already emitted; trajectories off adds includeTrajectory=false;
// a profile-type subset adds profileTypes=<comma list> (empty = none). A param
// is omitted when its layer(s) are fully on, so the URL stays clean. Returns
// '' or '?...'.
//
// excludeTrajectories forces includeTrajectory=false regardless of the layer
// toggle — used for the coverage-cells URL in tracks mode, where track lines
// replace the trajectory hexes but the OBIS cells stay.
function buildTileSuffix(baseQuery, dataLayers, excludeTrajectories = false) {
  const params = new URLSearchParams(baseQuery)
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
    if (!dataLayers.trajectories) params.set('includeTrajectory', 'false')
  }
  if (excludeTrajectories) params.set('includeTrajectory', 'false')
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
  setMapView,
  offsetFlyTo,
  rangeLevels,
  trajectoryRangeLevels,
  obisRangeLevels,
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
  activeWmsOverlay,
  projection = 'mercator',
  basemap = 'emodnet',
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
  const hexOpacity = 0.8
  const hexMinZoom = 0
  const hexMaxZoom = 7
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
  const trajectoryColorStops = useRef([])
  const obisColorStops = useRef([])
  const mixedColorStops = useRef([])
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
  // Raw selected-track response, cached so re-renders don't re-fetch.
  const rawTrackRef = useRef(null)

  // UTC-day-snapped scrub window: [scrub date - N days, scrub date + 1 day),
  // or [tracksMinDate, scrub date + 1 day) for the 'all' trail (full tracks
  // up to the scrub date — the default; see config.js). Day snapping keeps
  // the tile URLs stable so the server's URL-keyed tile cache gets hits
  // across scrubs and users.
  function tracksTimeWindow(scrub, trailing) {
    const MS_PER_DAY = 24 * 60 * 60 * 1000
    const end = new Date(`${scrub}T00:00:00Z`).getTime()
    const timeMax = `${new Date(end + MS_PER_DAY).toISOString().split('T')[0]}T00:00:00Z`
    const timeMin =
      trailing === TRAIL_ALL
        ? `${tracksMinDate}T00:00:00Z`
        : `${new Date(end - trailing * MS_PER_DAY).toISOString().split('T')[0]}T00:00:00Z`
    return { timeMin, timeMax }
  }

  // Tracks tile URL: dataset-level filters from the regular map query string,
  // minus the TimeSelector's timeMin/timeMax (the scrub window must not
  // fight the date-range filter), plus the day-snapped scrub window.
  function buildTracksTileUrl(queryString, scrub, trailing) {
    const params = new URLSearchParams(queryString)
    params.delete('timeMin')
    params.delete('timeMax')
    const { timeMin, timeMax } = tracksTimeWindow(scrub, trailing)
    params.set('timeMin', timeMin)
    params.set('timeMax', timeMax)
    return `${server}/tiles/tracks/{z}/{x}/{y}.mvt?${params.toString()}`
  }

  function refreshTracksSource(queryString, scrub, trailing) {
    if (!map.current || !map.current.getSource('tracks')) return
    // Swap the tile URL and re-render via the public setTiles API — it
    // clears the source's tile cache and reloads the viewport tiles.
    map.current
      .getSource('tracks')
      .setTiles([buildTracksTileUrl(queryString, scrub, trailing)])
  }

  // Rebuild the shared point/hex and coverage-cell source URLs from the
  // current filters AND the data-layer selection (plus tracks mode, which
  // pulls trajectory coverage out of the cells tiles), then force a refetch.
  // Shared by the filter-change, layer-toggle and tracks-mode effects.
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

  // Apply the tracks-mode layer visibility: track lines/heads show only when
  // trajectories are on AND tracks mode is active. Which data feeds the hex
  // layers (trajectories in/out of the coverage cells, OBIS on/off, profile
  // types) is decided server-side via the tile-URL params — see
  // buildTileSuffix; the blanket "Hexes & points" picker switch owns whole-map
  // observation-layer visibility (setLayersVisibility).
  function applyLayerVisibility() {
    if (!map.current || !map.current.getLayer('track-lines')) return
    const trajOn = dataLayersRef.current
      ? dataLayersRef.current.trajectories !== false
      : true
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
  const defaultRangeLevels = { zoom0: [0, 100], zoom1: [0, 100], zoom2: [0, 100] }
  const defaultTrajectoryRangeLevels = { zoom0: [0, 100], zoom1: [0, 100] }
  const defaultObisRangeLevels = { zoom0: [0, 100], zoom1: [0, 100] }

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

  useEffect(() => {
    setColorStops()
  }, [rangeLevels, trajectoryRangeLevels, obisRangeLevels])

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

  // The coverage-hex fill has to choose between three ramps per feature, and a
  // 'case' expression can't contain the legacy { property, stops } paint
  // function form the 'hexes' layer still uses — so these ramps are built as
  // real expressions instead. A single-stop ramp (a range of one value, e.g. a
  // filter that leaves one hex) can't be interpolated: fall back to the flat
  // color, since there's nothing to interpolate between.
  const rampExpression = (stops, property) => {
    if (stops.length === 0) return 'lightgrey'
    if (stops.length === 1) return stops[0][1]
    return ['interpolate', ['linear'], ['get', property], ...stops.flat()]
  }

  // Which of the three ramps a hex gets, and therefore what it says it holds:
  // trajectories, occurrence records, or both. Mixed hexes ramp on obis_count
  // (not the sum — trajectories and occurrence records aren't the same unit,
  // so adding them would produce a number in no unit at all); the hover
  // tooltip carries both exact figures.
  const coverageHexFillColor = () => [
    'case',
    [
      'all',
      ['>', ['get', 'trajectory_count'], 0],
      ['>', ['get', 'obis_count'], 0]
    ],
    rampExpression(mixedColorStops.current, 'obis_count'),
    ['>', ['get', 'trajectory_count'], 0],
    rampExpression(trajectoryColorStops.current, 'trajectory_count'),
    rampExpression(obisColorStops.current, 'obis_count')
  ]

  const coverageHexOutlineColor = () => [
    'case',
    [
      'all',
      ['>', ['get', 'trajectory_count'], 0],
      ['>', ['get', 'obis_count'], 0]
    ],
    mixedColorScale[2],
    ['>', ['get', 'trajectory_count'], 0],
    trajectoryColorScale[2],
    obisColorScale[2]
  ]

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
    // grid is always used, so there's a single range to apply per ramp. The
    // mixed ramp shares the OBIS range because it ramps on obis_count.
    const effectiveTrajectoryRangeLevels =
      trajectoryRangeLevels || defaultTrajectoryRangeLevels
    trajectoryColorStops.current = generateColorStops(
      trajectoryColorScale,
      effectiveTrajectoryRangeLevels.zoom1
    ).map((colorStop) => {
      return [colorStop.stop, colorStop.color]
    })

    const effectiveObisRangeLevels = obisRangeLevels || defaultObisRangeLevels
    obisColorStops.current = generateColorStops(
      obisColorScale,
      effectiveObisRangeLevels.zoom1
    ).map((colorStop) => {
      return [colorStop.stop, colorStop.color]
    })
    mixedColorStops.current = generateColorStops(
      mixedColorScale,
      effectiveObisRangeLevels.zoom1
    ).map((colorStop) => {
      return [colorStop.stop, colorStop.color]
    })

    // A focused dataset outranks the count ramp: greying everything else is
    // what makes that dataset legible, so painting the ramp back over it here
    // would silently undo the focus. This runs on zoomend and on every legend
    // refetch — both of which a "zoom to dataset" click triggers — so without
    // this the map un-greyed itself the moment the camera settled. The stops
    // above are still refreshed, ready for when the focus clears.
    if (focusedDatasetPk.current && layersLoaded.current) {
      hoverHighlightPoints(focusedDatasetPk.current)
      return
    }

    if (colorStops.current.length > 0) {
      if (map.current.getZoom() >= 7 && map.current.getLayer('points')) {
        map.current.setPaintProperty('points', 'circle-color', colors)
      }
      // Always keep the hexes layer's stops populated, not just when zoomed
      // into the hex band — a reload while zoomed in (zoom >= 7) would
      // otherwise leave it unpainted so hexes never appear on zoom-out. It's
      // hidden above z7 anyway, and zoomend re-runs this to refine the z0/z1
      // band.
      if (map.current.getLayer('hexes')) {
        map.current.setPaintProperty('hexes', 'fill-color', {
          property: 'count',
          stops: colorStops.current
        })
      }
    }

    if (map.current.getLayer('coverage-hexes')) {
      map.current.setPaintProperty(
        'coverage-hexes',
        'fill-color',
        coverageHexFillColor()
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

    // Which of the currently rendered features belong to the focused dataset.
    // queryRenderedFeatures only sees what is on screen now, which is why this
    // has to be re-run every time new tiles land (see the sourcedata handler).
    const pointLevel = map.current.getZoom() >= 7
    const featurePksInDataset = (layer) =>
      map.current
        .queryRenderedFeatures({ layers: [layer] })
        .filter((feature) =>
          JSON.parse(feature.properties.datasets).includes(pk)
        )
        .map((feature) => feature.properties.pk)

    const focusedPks = pk
      ? featurePksInDataset(pointLevel ? 'points' : 'hexes')
      : []
    const focusedCoveragePks = pk ? featurePksInDataset('coverage-hexes') : []

    // Repainting makes the map fire the very events that re-run this, so a
    // no-op has to stay a no-op or the map spins in a render loop. The zoom
    // band is part of the signature because it decides which layer is greyed.
    const signature = JSON.stringify([
      pk,
      pointLevel,
      focusedPks,
      focusedCoveragePks
    ])
    if (signature === appliedFocus.current) return
    appliedFocus.current = signature

    if (pk) {
      if (pointLevel) {
        map.current.setPaintProperty('points', 'circle-color', 'lightgrey')
        map.current.setPaintProperty(
          'points-highlighted',
          'circle-color',
          'lightgrey'
        )
        map.current.setPaintProperty(
          'points-highlighted',
          'circle-stroke-width',
          0
        )
        map.current.setFilter('points-hovered', ['in', 'pk', ...focusedPks])
      } else {
        map.current.setPaintProperty('hexes', 'fill-color', 'lightgrey')
        map.current.setFilter('hexes-hovered', ['in', 'pk', ...focusedPks])
      }

      map.current.setPaintProperty('coverage-hexes', 'fill-color', 'lightgrey')
      map.current.setFilter('coverage-hexes-hovered', [
        'in',
        'pk',
        ...focusedCoveragePks
      ])
    } else {
      map.current.setFilter('points-hovered', ['in', 'pk', ''])
      map.current.setPaintProperty('points', 'circle-color', colors)
      map.current.setPaintProperty('points-highlighted', 'circle-color', colors)
      map.current.setPaintProperty(
        'points-highlighted',
        'circle-stroke-width',
        1
      )
      map.current.setFilter('hexes-hovered', ['in', 'pk', ''])
      map.current.setPaintProperty('hexes', 'fill-color', {
        property: 'count',
        stops: colorStops.current
      })

      map.current.setFilter('coverage-hexes-hovered', ['in', 'pk', ''])
      map.current.setPaintProperty(
        'coverage-hexes',
        'fill-color',
        coverageHexFillColor()
      )
    }
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

  function griddapFeaturesAt(point) {
    const features = map.current.queryRenderedFeatures(point, {
      layers: ['griddap-coverage-fill']
    })
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
    'hexes-hovered',
    'points',
    'points-halo',
    'points-hovered',
    'points-highlighted',
    'coverage-hexes',
    'coverage-hexes-hovered',
    'track-lines',
    'track-heads',
    'track-heads-fixed',
    'selected-track-line',
    'selected-track-fixes',
    'selected-track-fixes-nocog'
  ]
  const griddapLayerIds = ['griddap-coverage-fill', 'griddap-coverage-line']
  // Mirrors the dataLayersVisible prop so removeWmsOverlay (called from map
  // event handlers) restores the user's toggle instead of forcing layers on.
  const dataLayersVisibleRef = useRef(true)

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

  function setDataLayersVisibility(visible) {
    setLayersVisibility(griddapLayerIds, visible)
    setLayersVisibility(
      observationLayerIds,
      visible && dataLayersVisibleRef.current
    )
    // The blanket show clobbers the tracks-vs-coverage-hexes split; re-apply
    // the per-data-type toggles on top of it.
    if (visible && dataLayersVisibleRef.current) applyLayerVisibility()
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
  useEffect(() => {
    dataLayersVisibleRef.current = dataLayersVisible
    if (!map.current || activeWmsOverlay) return
    setLayersVisibility(observationLayerIds, dataLayersVisible)
    // Blanket show clobbers the tracks-vs-coverage-hexes split; re-apply it.
    if (dataLayersVisible) applyLayerVisibility()
  }, [dataLayersVisible])

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

  // Layer-picker basemap switch. Swaps only the bathymetry/water-tint layers
  // in place (see applyBasemap) rather than map.setStyle(), which would drop
  // every data layer added imperatively below. map.current is still null on
  // this effect's first run (the map-creation effect further down hasn't
  // fired yet), so the initial basemap — already baked into the style passed
  // to `new maplibreGl.Map(...)` — is never redundantly re-applied here.
  useEffect(() => {
    if (!map.current) return
    applyBasemap(map.current, basemap)
  }, [basemap])

  // "Zoom to dataset": frame the requested footprint. The camera settings are
  // shared with ZoomToDataset, which compares them against the live camera to
  // decide whether the button still has anything to do.
  useEffect(() => {
    if (!map.current || !zoomTarget?.geometry) return
    const bounds = boundsFromGeoJson(zoomTarget.geometry)
    if (!bounds) return
    map.current.fitBounds(bounds, {
      ...zoomToDatasetCamera(map.current),
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

  // The filter query and the data-layer selection (plus tracks mode, which
  // pulls trajectory coverage out of the cells tiles) combine into the two
  // shared source URLs — see buildTileSuffix.
  const tileUrls = (queryString) => {
    const filterSuffix = buildTileSuffix(queryString, dataLayersRef.current)
    const cellFilterSuffix = buildTileSuffix(
      queryString,
      dataLayersRef.current,
      tracksModeRef.current
    )
    return {
      tileQuery: `${server}/tiles/{z}/{x}/{y}.mvt${filterSuffix}`,
      cellTileQuery: `${server}/tiles/cells/{z}/{x}/{y}.mvt${cellFilterSuffix}`
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

  // Data-layer toggle: refetch the combined/coverage-cell sources with the
  // new profileTypes/includeObis/includeTrajectory params and re-apply
  // layer visibility.
  useEffect(() => {
    dataLayersRef.current = dataLayers
    // Source existence, not map.loaded() — see the filter effect above.
    if (!map.current || !map.current.getSource('cde-tiles')) return
    refreshCombinedSources(mapQueryString)
    applyLayerVisibility()
  }, [dataLayers])

  // Tracks mode: swap the trajectory coverage hexes for track lines/heads
  // (respecting the trajectories layer toggle) and load the scrub window.
  // The coverage-cells source refetches too: in tracks mode the trajectory
  // counts leave the cells tiles (track lines replace them) while the OBIS
  // cells stay — see tileUrls.
  useEffect(() => {
    tracksModeRef.current = tracksMode
    if (!map.current || !map.current.getLayer('track-lines')) return
    applyLayerVisibility()
    refreshCombinedSources(mapQueryString)
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
      // Same framing the "zoom to dataset" button uses: the sidebar overlays the
      // canvas, and a track picked on the map opens it at the same moment as this
      // fit, so uniform padding would centre the track underneath it.
      map.current.fitBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)]
        ],
        zoomToDatasetCamera(map.current)
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
        ...buildBasemapStyle(i18n.language, basemap),
        projection: { type: projection === 'globe' ? 'globe' : 'mercator' }
      },
      // MapLibre defaults to powerPreference 'high-performance', which wakes
      // the discrete GPU on dual-GPU laptops. The map is circles and fills —
      // the integrated GPU renders it fine, so hint 'low-power'.
      canvasContextAttributes: { powerPreference: 'low-power' },
      // Per-source attributions replace the default control (see the compact
      // AttributionControl added below).
      attributionControl: false,
      center: [mapLongitude || -150, mapLatitude || 60], // starting position
      zoom: mapZoom || 2 // starting zoom,
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
      // hover/highlight layers render nothing until a pk filter is set, and
      // those pks always come from queryRenderedFeatures on the filtered
      // layers, so sharing the filtered sources loses nothing.
      map.current.addSource('cde-tiles', {
        type: 'vector',
        tiles: [tileQuery]
      })
      map.current.addSource('cde-cells', {
        type: 'vector',
        tiles: [cellTileQuery]
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
          'circle-radius': [
            'case',
            ['<=', ['get', 'count'], 2],
            smallCircleSize,
            ['>', ['get', 'count'], 2],
            largeCircleSize,
            5
          ],
          'circle-color': colors,
          'circle-stroke-color': colors,
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
            'fill-color': coverageHexFillColor(),
            'fill-outline-color': coverageHexOutlineColor()
          }
        },
        'points'
      )

      map.current.addLayer(
        {
          id: 'coverage-hexes-hovered',
          type: 'fill',
          minzoom: hexMaxZoom,
          source: 'cde-cells',
          'source-layer': 'coverage-hexes-layer',
          paint: {
            'fill-opacity': coverageHexOpacity,
            'fill-color': coverageHexFillColor(),
            'fill-outline-color': coverageHexOutlineColor()
          },
          filter: ['in', 'pk', '']
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
            'circle-radius': [
              'case',
              ['<=', ['get', 'count'], 2],
              smallCircleSize + 1.25,
              ['>', ['get', 'count'], 2],
              largeCircleSize + 1.25,
              6.25
            ]
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
          'fill-color': {
            property: 'count',
            stops: colorStops.current
          }
        }
      }, FIRST_LABEL_LAYER_ID)

      map.current.addLayer({
        id: 'hexes-hovered',
        type: 'fill',
        minzoom: hexMinZoom,
        maxzoom: hexMaxZoom,
        source: 'cde-tiles',
        'source-layer': 'internal-layer-name',

        paint: {
          'fill-opacity': hexOpacity,
          'fill-color': {
            property: 'count',
            stops: colorStops.current
          }
        },
        filter: ['in', 'pk', '']
      }, FIRST_LABEL_LAYER_ID)

      map.current.addLayer({
        id: 'points-highlighted',
        type: 'circle',
        minzoom: hexMaxZoom,
        source: 'cde-tiles',
        'source-layer': 'internal-layer-name',
        paint: {
          'circle-color': colors,
          'circle-opacity': circleOpacity,
          'circle-radius': [
            'case',
            ['<=', ['get', 'count'], 2],
            smallCircleSize,
            ['>', ['get', 'count'], 2],
            largeCircleSize,
            5
          ],
          'circle-stroke-color': 'black',
          'circle-stroke-width': 0.75
        },
        filter: ['in', 'pk', '']
      }, FIRST_LABEL_LAYER_ID)

      map.current.addLayer({
        id: 'points-hovered',
        type: 'circle',
        minzoom: hexMaxZoom,
        source: 'cde-tiles',
        'source-layer': 'internal-layer-name',
        paint: {
          'circle-color': colors,
          'circle-opacity': circleOpacity,
          'circle-radius': [
            'case',
            ['<=', ['get', 'count'], 2],
            smallCircleSize,
            ['>', ['get', 'count'], 2],
            largeCircleSize,
            5
          ]
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

      // --- Tracks mode layers -------------------------------------------
      // Track lines + head positions from /tiles/tracks, shown only when
      // tracks mode is on (visibility swaps with the trajectory hex layers).
      // Created via refs so the current mode/scrub window applies even
      // though this load handler runs once.
      const tracksVisibility = tracksModeRef.current ? 'visible' : 'none'
      map.current.addSource('tracks', {
        type: 'vector',
        // No minzoom: track lines/heads render at every zoom level, including
        // fully zoomed out. maxzoom caps the fetched tile zoom at 8 and lets
        // maplibre overzoom past it rather than re-fetch expensive tiles at
        // every zoom level in. NOTE: at low zoom a single tile can assemble
        // every trajectory over the whole time window (100k+ features,
        // multi-MB) — the bounded default trail (defaultTrailingDays, see
        // config.js) keeps that in check; the 'all' trail while zoomed out is
        // the heavy case. If it regresses, add server-side low-zoom
        // simplification in web-api/routes/tiles.js rather than a minzoom.
        maxzoom: 8,
        tiles: [
          buildTracksTileUrl(
            mapQueryRef.current,
            scrubTimeRef.current,
            trailingDaysRef.current
          )
        ]
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

      // Apply the initial trajectory layer visibility from the URL-restored
      // tracks mode + data-layer selection (track lines vs coverage hexes vs
      // trajectories-off).
      applyLayerVisibility()

      // Layers are created visible; re-apply the picker state in case the
      // observation layers were toggled off before the style finished loading.
      if (!dataLayersVisibleRef.current) {
        setLayersVisibility(observationLayerIds, false)
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
      // A track under the cursor wins: the hexes keep their trajectory counts in
      // tracks mode, so a hex sits under every track line, and this handler's
      // zoom-to-7 flyTo would fight the fit the track selection is about to do.
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
    const POINT_HIT_GRACE_PX = 2
    const isOnAPoint = (e) =>
      renderedFeatures(e.point, ['points']).some((feature) => {
        const centre = map.current.project(feature.geometry.coordinates)
        const radius =
          (feature.properties.count <= 2 ? smallCircleSize : largeCircleSize) +
          POINT_HIT_GRACE_PX
        return (
          (centre.x - e.point.x) ** 2 + (centre.y - e.point.y) ** 2 <=
          radius ** 2
        )
      })

    // The track feature under a point, ranked by trackClickLayers rather than by
    // render order, so a head from one trajectory and a line from another under
    // the same cursor resolve the same way every time (the track-lines hover
    // handler makes the same hand-off). Doubles as the "is a track under the
    // cursor" test the hex and griddap handlers use to stand aside: hidden
    // layers aren't hit-testable, so this is empty whenever tracks mode is off
    // and no tracksMode check is needed.
    const trackFeatureAt = (point) =>
      renderedFeatures(point, trackClickLayers)
        .sort(
          (a, b) =>
            trackClickLayers.indexOf(a.layer.id) -
            trackClickLayers.indexOf(b.layer.id)
        )[0]

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

    map.current.on('mousemove', (e) => {
      setHoveredDataset()
    })

    map.current.on('mousemove', 'points', (e) => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'pointer'
        const coordinates = e.features[0].geometry.coordinates.slice()
        popup
          .setLngLat(coordinates)
          .setHTML(
            ` <div>
                  ${e.features[0].properties.count} ${t('mapPointHoverTooltip')}
                </div> 
              `
          )
          .addTo(map.current)
      }
    })

    map.current.on('mouseleave', 'points', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'

        popup.remove()
      }
    })

    map.current.on('mousemove', 'hexes', (e) => {
      if (griddapOutranksHexes(e)) return
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'pointer'
        const coordinates = [e.lngLat.lng, e.lngLat.lat]
        const description = e.features[0].properties.count

        popup
          .setLngLat(coordinates)
          .setHTML(description + t('mapHexHoverTooltip'))
          .addTo(map.current)
      }
    })

    map.current.on('mouseleave', 'hexes', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'

        popup.remove()
      }
    })

    map.current.on('mousemove', 'coverage-hexes', (e) => {
      // 'points' renders on top of 'coverage-hexes' at the same zoom
      // range — defer to its own mousemove/tooltip when the cursor is
      // directly over a point, instead of clobbering it here.
      if (
        !draw.getMode().includes('draw') &&
        map.current.queryRenderedFeatures(e.point, { layers: ['points'] })
          .length === 0
      ) {
        map.current.getCanvas().style.cursor = 'pointer'
        const coordinates = [e.lngLat.lng, e.lngLat.lat]
        const { trajectory_count: trajectories, obis_count: occurrences } =
          e.features[0].properties

        // Name what's actually in the hex: the two kinds of coverage cell
        // share this layer, and a hex can hold both.
        let description
        if (trajectories > 0 && occurrences > 0) {
          description = t('mapCoverageHexBothHoverTooltip', {
            trajectories,
            occurrences
          })
        } else if (trajectories > 0) {
          description = t('mapTrajectoryHexHoverTooltip', { trajectories })
        } else {
          description = t('mapObisHexHoverTooltip', { occurrences })
        }

        popup.setLngLat(coordinates).setHTML(description).addTo(map.current)
      }
    })

    map.current.on('mouseleave', 'coverage-hexes', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
      }
    })

    ;['track-heads', 'track-heads-fixed'].forEach((layerId) => {
      map.current.on('mousemove', layerId, (e) => {
        // These tooltips are registered after the 'points' one, so they would
        // otherwise paint over it and offer a click hint where the click will
        // go to the point instead (see isOnAPoint).
        if (!draw.getMode().includes('draw') && !isOnAPoint(e)) {
          map.current.getCanvas().style.cursor = 'pointer'
          const properties = e.features[0].properties
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
      })

      map.current.on('mouseleave', layerId, () => {
        if (!draw.getMode().includes('draw')) {
          map.current.getCanvas().style.cursor = 'grab'
          popup.remove()
        }
      })
    })

    ;['selected-track-fixes', 'selected-track-fixes-nocog'].forEach((layerId) => {
      map.current.on('mousemove', layerId, (e) => {
        if (!draw.getMode().includes('draw')) {
          map.current.getCanvas().style.cursor = 'pointer'
          const properties = e.features[0].properties
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
      })

      map.current.on('mouseleave', layerId, () => {
        if (!draw.getMode().includes('draw')) {
          map.current.getCanvas().style.cursor = 'grab'
          popup.remove()
        }
      })
    })

    map.current.on('mousemove', 'track-lines', (e) => {
      // Heads sit above lines, and the selected track's own fixes above both —
      // let whichever is under the cursor keep its more specific tooltip (the
      // head's date, the fix's timestamp).
      if (
        !draw.getMode().includes('draw') &&
        !isOnAPoint(e) &&
        renderedFeatures(e.point, [
          'track-heads',
          'track-heads-fixed',
          ...selectedTrackLayers
        ]).length === 0
      ) {
        map.current.getCanvas().style.cursor = 'pointer'
        const properties = e.features[0].properties
        popup
          .setLngLat([e.lngLat.lng, e.lngLat.lat])
          .setHTML(
            `<div>${properties.dataset_title ? `<b>${escapeHtml(properties.dataset_title)}</b><br/>` : ''}${escapeHtml(properties.trajectory_id)}${trackClickHint(properties)}</div>`
          )
          .addTo(map.current)
      }
    })

    map.current.on('mouseleave', 'track-lines', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
      }
    })

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

    map.current.on('mousemove', 'griddap-coverage-fill', (e) => {
      if (draw.getMode().includes('draw') || griddapFeatureIsCovered(e)) {
        showGriddapTooltip.cancel()
        setGriddapHovered([])
        return
      }
      map.current.getCanvas().style.cursor = 'pointer'
      showGriddapTooltip(e, griddapFeaturesAt(e.point))
    })

    map.current.on('mouseleave', 'griddap-coverage-fill', () => {
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
    // (EMODnet / Esri + OpenFreeMap).
    const attribution = new AttributionControl({
      compact: true
    })
    map.current.addControl(attribution, 'bottom-right')
    map.current.addControl(scale, 'bottom-right')

    // Called order determines stacking order
    map.current.addControl(
      new NavigationControl({ showCompass: false }),
      'bottom-right'
    )
    map.current.addControl(drawPolygon.current, 'bottom-right')

    updateMapToolTitleLanguage(t)
  }, [])

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
  }, [rangeLevels, trajectoryRangeLevels, obisRangeLevels])

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
