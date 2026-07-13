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
  createDataFilterQueryString,
  generateColorStops,
  getCurrentRangeLevel,
  updateMapToolTitleLanguage,
  catmullRomSpline,
  splitTrackRuns,
  initialBearing
} from '../../utilities'
import {
  buildWmsGetMapUrl,
  clampBoundsForWms,
  warpEquirectToMercator
} from '../../wmsUtilities'
import {
  colorScale,
  trajectoryColorScale,
  trackLineColor,
  selectedTrackColor,
  tracksMinDate,
  TRAIL_ALL,
  basemap
} from '../config'
import platformColors from '../../components/platformColors'
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

// Data-layer keys that map to profile cdm_data_types (all share cde.profiles).
const PROFILE_TYPE_KEYS = [
  ['profile', 'Profile'],
  ['timeseries', 'TimeSeries'],
  ['timeseriesProfile', 'TimeSeriesProfile']
]

// Combine the filter-derived query string with the data-layer selection into
// a tile-URL suffix. OBIS off adds includeObis=false, OR-ed with any the
// Source filter already emitted; trajectories off adds includeTrajectory=false;
// a profile-type subset adds profileTypes=<comma list> (empty = none). A param
// is omitted when its layer(s) are fully on, so the URL stays clean. Returns
// '' or '?...'.
function buildTileSuffix(baseQuery, dataLayers) {
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
  const s = params.toString()
  return s ? `?${s}` : ''
}

// Using Maplibre with React: https://documentation.maptiler.com/hc/en-us/articles/4405444890897-Display-MapLibre-GL-JS-map-using-React-JS
export default function CreateMap({
  query,
  setPointsToReview,
  polygon,
  setPolygon,
  setLoading,
  setMapView,
  offsetFlyTo,
  rangeLevels,
  trajectoryRangeLevels,
  hoveredDataset,
  setHoveredDataset,
  setDatasetsSelected,
  tracksMode,
  scrubTime,
  trailingDays,
  smoothTracks,
  selectedTrajectory,
  dataLayers,
  griddapCoverage,
  dataLayersVisible = true,
  activeWmsOverlay,
  projection = 'mercator'
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
  // 0.55 at the z7 hand-off (where trajectory counts stop being merged into
  // the green hexes layer), fading to a light coverage wash by z10 so the
  // point circles stay readable over dense trajectory areas.
  const trajectoryHexOpacity = [
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
  // Latest tracks-mode props for the one-shot map 'load' closure (layers are
  // created once; these refs let it apply the current mode/scrub window).
  const tracksModeRef = useRef(tracksMode)
  const scrubTimeRef = useRef(scrubTime)
  const trailingDaysRef = useRef(trailingDays)
  const dataLayersRef = useRef(dataLayers)
  // Raw (unsmoothed) selected-track response, cached so toggling smoothing
  // re-renders without re-fetching.
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

  // Tracks tile URL: dataset-level filters from the regular query string,
  // minus the TimeSelector's timeMin/timeMax (the scrub window must not
  // fight the date-range filter), plus the day-snapped scrub window.
  function buildTracksTileUrl(activeQuery, scrub, trailing) {
    const params = new URLSearchParams(createDataFilterQueryString(activeQuery))
    params.delete('timeMin')
    params.delete('timeMax')
    const { timeMin, timeMax } = tracksTimeWindow(scrub, trailing)
    params.set('timeMin', timeMin)
    params.set('timeMax', timeMax)
    return `${server}/tiles/tracks/{z}/{x}/{y}.mvt?${params.toString()}`
  }

  function refreshTracksSource(activeQuery, scrub, trailing) {
    if (!map.current || !map.current.getSource('tracks')) return
    // Swap the tile URL and re-render via the public setTiles API — it
    // clears the source's tile cache and reloads the viewport tiles.
    map.current
      .getSource('tracks')
      .setTiles([buildTracksTileUrl(activeQuery, scrub, trailing)])
  }

  // Rebuild the combined (profiles + OBIS + trajectory-coverage) and
  // trajectory-hex source URLs from the current filters AND the data-layer
  // selection, then force a refetch. Shared by the filter-change and
  // layer-toggle effects.
  function refreshCombinedSources(activeQuery) {
    if (!map.current || !map.current.loaded()) return
    const suffix = buildTileSuffix(
      createDataFilterQueryString(activeQuery),
      dataLayersRef.current
    )
    const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt${suffix}`
    const trajectoryTileQuery = `${server}/tiles/trajectories/{z}/{x}/{y}.mvt${suffix}`
    // Swap the tile URLs and re-render via the public setTiles API — it
    // clears each source's tile cache and reloads the viewport tiles.
    map.current.getSource('points').setTiles([tileQuery])
    map.current.getSource('points-halo').setTiles([tileQuery])
    map.current.getSource('hexes').setTiles([tileQuery])
    map.current.getSource('trajectory-hexes').setTiles([trajectoryTileQuery])
  }

  // Apply layer visibility from the data-layer + display toggles:
  //  - track lines: trajectories on AND tracks-mode sub-toggle;
  //  - trajectory coverage hexes: trajectories on, NOT tracks mode, hex cells on;
  //  - combined (profiles/OBIS/trajectory) hexes: hex cells on.
  // The "hex cells" toggle hides only the hexagon-aggregation layers, never
  // the track lines or the high-zoom point layer.
  function applyLayerVisibility() {
    if (!map.current || !map.current.getLayer('track-lines')) return
    const trajOn = dataLayersRef.current
      ? dataLayersRef.current.trajectories !== false
      : true
    const hexOn = dataLayersRef.current
      ? dataLayersRef.current.hexCells !== false
      : true
    const showTracks = trajOn && tracksModeRef.current
    const showTrajHexes = trajOn && !tracksModeRef.current && hexOn
    ;['track-lines', 'track-heads', 'track-heads-fixed'].forEach((id) =>
      map.current.setLayoutProperty(id, 'visibility', showTracks ? 'visible' : 'none')
    )
    ;['trajectory-hexes', 'trajectory-hexes-hovered'].forEach((id) =>
      map.current.setLayoutProperty(id, 'visibility', showTrajHexes ? 'visible' : 'none')
    )
    ;['hexes', 'hexes-hovered'].forEach((id) =>
      map.current.setLayoutProperty(id, 'visibility', hexOn ? 'visible' : 'none')
    )
  }

  // Placeholder count ranges used only until the /legend request resolves.
  // The map now mounts before that response arrives, but the count-driven
  // layers ('hexes'/'trajectory-hexes') must still be created with VALID,
  // non-empty color stops — MapLibre silently drops any layer whose paint
  // function has zero stops, which is why creating them from empty stops left
  // them missing entirely. The real ramp replaces these as soon as the legend
  // lands (setColorStops re-runs via the [rangeLevels] effect).
  const defaultRangeLevels = { zoom0: [0, 100], zoom1: [0, 100], zoom2: [0, 100] }
  const defaultTrajectoryRangeLevels = { zoom0: [0, 100], zoom1: [0, 100] }

  const [boxSelectStartCoords, setBoxSelectStartCoords] = useState()
  const [boxSelectEndCoords, setBoxSelectEndCoords] = useState()

  const popup = new Popup({
    closeButton: false,
    closeOnClick: true,
    maxWidth: '400px'
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
  }, [rangeLevels, trajectoryRangeLevels])

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

    // Trajectory hexes only ever render at zoom >= hexMaxZoom, where the
    // hex_1 grid is always used, so there's a single range to apply.
    const effectiveTrajectoryRangeLevels =
      trajectoryRangeLevels || defaultTrajectoryRangeLevels
    trajectoryColorStops.current = generateColorStops(
      trajectoryColorScale,
      effectiveTrajectoryRangeLevels.zoom1
    ).map((colorStop) => {
      return [colorStop.stop, colorStop.color]
    })
    if (
      trajectoryColorStops.current.length > 0 &&
      map.current.getLayer('trajectory-hexes')
    ) {
      map.current.setPaintProperty('trajectory-hexes', 'fill-color', {
        property: 'count',
        stops: trajectoryColorStops.current
      })
    }
  }

  function hoverHighlightPoints(pk) {
    if (!map.current || !layersLoaded.current) return

    if (pk) {
      if (map.current.getZoom() >= 7) {
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

        const features = map.current.queryRenderedFeatures({
          layers: ['points']
        })
        const pointsInDataset = features
          .filter((feature) => {
            const featureDatasetPKs = JSON.parse(feature.properties.datasets)
            return featureDatasetPKs.includes(pk)
          })
          .map((feature) => feature.properties.pk)
        map.current.setFilter('points-hovered', [
          'in',
          'pk',
          ...pointsInDataset
        ])
      } else {
        map.current.setPaintProperty('hexes', 'fill-color', 'lightgrey')
        const features = map.current.queryRenderedFeatures({
          layers: ['hexes']
        })
        const hexesInDataset = features
          .filter((feature) =>
            JSON.parse(feature.properties.datasets).includes(pk)
          )
          .map((feature) => feature.properties.pk)
        map.current.setFilter('hexes-hovered', ['in', 'pk', ...hexesInDataset])
      }

      map.current.setPaintProperty('trajectory-hexes', 'fill-color', 'lightgrey')
      const trajectoryFeatures = map.current.queryRenderedFeatures({
        layers: ['trajectory-hexes']
      })
      const trajectoryHexesInDataset = trajectoryFeatures
        .filter((feature) =>
          JSON.parse(feature.properties.datasets).includes(pk)
        )
        .map((feature) => feature.properties.pk)
      map.current.setFilter('trajectory-hexes-hovered', [
        'in',
        'pk',
        ...trajectoryHexesInDataset
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

      map.current.setFilter('trajectory-hexes-hovered', ['in', 'pk', ''])
      map.current.setPaintProperty('trajectory-hexes', 'fill-color', {
        property: 'count',
        stops: trajectoryColorStops.current
      })
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

  // While a WMS overlay is active every other data layer is hidden so the
  // gridded field reads cleanly; only the basemap, the raster and the
  // dataset's bbox outline stay visible. The observation layers (hexes,
  // points, trajectories) are listed separately from the griddap coverage
  // layers because the layer picker can hide them independently.
  const observationLayerIds = [
    'hexes',
    'hexes-hovered',
    'points',
    'points-halo',
    'points-hovered',
    'points-highlighted',
    'trajectory-hexes',
    'trajectory-hexes-hovered',
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
  function renderWmsImage(overlay) {
    if (!map.current) return
    const bounds = clampBoundsForWms(map.current.getBounds())
    if (bounds.south >= bounds.north || bounds.west >= bounds.east) return
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
          map.current.getLayer('trajectory-hexes') ? 'trajectory-hexes' : undefined
        )
      }
    }
    img.onerror = () => console.warn(`WMS GetMap failed: ${url}`)
    img.src = url
  }

  useEffect(() => {
    if (map.current) {
      if (hoveredDataset?.cdm_data_type === 'Grid') {
        // A griddap dataset has no map features: highlighting its pk would
        // grey the whole map with nothing selected. Draw its bbox instead.
        hoverHighlightPoints()
        setGriddapHighlight(hoveredDataset.coverage_bbox_geojson)
      } else {
        setGriddapHighlight(activeWmsOverlay ? activeWmsOverlay.bbox : null)
        hoverHighlightPoints(hoveredDataset?.pk)
      }
    }
  }, [hoveredDataset, activeWmsOverlay])

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

  useEffect(() => {
    if (!map.current) return
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
  }, [activeWmsOverlay])

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

  useEffect(() => {
    setPointsToReview()
    setPolygon()
    if (map && map.current && map.current.loaded()) {
      map.current.setFilter('points-highlighted', ['in', 'pk', ''])
      refreshCombinedSources(query)
      setLoading(true)
      doFinalCheck.current = true
      if (drawPolygon.current.getAll().features.length > 0) {
        highlightPoints(
          drawPolygon.current.getAll().features[0].geometry.coordinates[0]
        )
        setPolygon(
          drawPolygon.current.getAll().features[0].geometry.coordinates[0]
        )
      }
    }
  }, [query])

  // Data-layer toggle: refetch the combined/trajectory sources with the new
  // includeProfiles/includeObis/includeTrajectory params and re-apply
  // trajectory layer visibility.
  useEffect(() => {
    dataLayersRef.current = dataLayers
    if (!map.current || !map.current.loaded()) return
    refreshCombinedSources(query)
    applyLayerVisibility()
  }, [dataLayers])

  // Tracks mode: swap the trajectory coverage hexes for track lines/heads
  // (respecting the trajectories layer toggle) and load the scrub window.
  useEffect(() => {
    tracksModeRef.current = tracksMode
    if (!map.current || !map.current.getLayer('track-lines')) return
    applyLayerVisibility()
    if (tracksMode) {
      refreshTracksSource(query, scrubTime, trailingDays)
    }
  }, [tracksMode])

  // Scrubbing / trailing-window / filter changes re-query the tracks tiles.
  useEffect(() => {
    scrubTimeRef.current = scrubTime
    trailingDaysRef.current = trailingDays
    if (!tracksMode) return
    refreshTracksSource(query, scrubTime, trailingDays)
  }, [query, scrubTime, trailingDays])

  // Selected platform: fetch its full track once, render raw or smoothed
  // (smoothing is render-only — raw response cached in rawTrackRef), dim the
  // global track layers, and fit the view to the track.
  useEffect(() => {
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
        const response = await fetch(
          `${server}/trajectories/track?datasetPKs=${datasetPk}&trajectoryId=${encodeURIComponent(trajectoryId)}`
        )
        if (!response.ok) return
        const track = await response.json()
        rawTrackRef.current = {
          key: cacheKey,
          coordinates: track.coordinates,
          times: track.times
        }
      }
      const { coordinates: rawCoordinates, times: rawTimes } = rawTrackRef.current
      if (!rawCoordinates || rawCoordinates.length === 0) return

      // Split at the antimeridian and at large time gaps BEFORE smoothing so
      // the spline never interpolates across the seam or across a data gap
      // (same segmentation rule as the /tiles/tracks layer).
      const runs = splitTrackRuns(rawCoordinates, rawTimes)
      const lineFeatures = runs
        .filter((run) => run.length >= 2)
        .map((run) => ({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: smoothTracks ? catmullRomSpline(run) : run
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
      map.current.fitBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)]
        ],
        { padding: 80, maxZoom: 9 }
      )
    }
    renderSelectedTrack()
  }, [selectedTrajectory, smoothTracks])

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
      style: buildBasemapStyle(i18n.language, basemap),
      // Per-source attributions replace the default control (see the compact
      // AttributionControl added below).
      attributionControl: false,
      center: [mapLongitude || -150, mapLatitude || 60], // starting position
      zoom: mapZoom || 2 // starting zoom,
    })

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

      boxQueryElement.onclick = (e) => {
        map.current.getCanvas().style.cursor = 'crosshair'
        deleteAllShapes()
        creatingPolygon.current = true
        drawPolygon.current.changeMode('draw_rectangle')
        return false
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

      const filterSuffix = buildTileSuffix(
        createDataFilterQueryString(query),
        dataLayersRef.current
      )

      const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt${filterSuffix}`

      const trajectoryTileQuery = `${server}/tiles/trajectories/{z}/{x}/{y}.mvt${filterSuffix}`

      // Every data layer is inserted below the basemap's label layers
      // (beforeId FIRST_LABEL_LAYER_ID or an existing data layer) so water
      // and place names stay readable over hexes and points.
      map.current.addLayer({
        id: 'points',
        type: 'circle',
        minzoom: hexMaxZoom,
        source: {
          type: 'vector',
          tiles: [tileQuery]
        },
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

      // Inserted with beforeId 'points' (which must already exist on the
      // map — MapLibre throws otherwise) so trajectory hexes sit at the
      // bottom of the stack, under the points layer. Below hexMaxZoom,
      // trajectory counts are already merged into the green 'hexes' layer;
      // this purple layer only takes over once profiles switch to points.
      map.current.addLayer(
        {
          id: 'trajectory-hexes',
          type: 'fill',
          minzoom: hexMaxZoom,
          source: {
            type: 'vector',
            tiles: [trajectoryTileQuery]
          },
          'source-layer': 'trajectory-hexes-layer',
          paint: {
            'fill-opacity': trajectoryHexOpacity,
            'fill-color': {
              property: 'count',
              stops: trajectoryColorStops.current
            },
            'fill-outline-color': '#B29CDD'
          }
        },
        'points'
      )

      map.current.addLayer(
        {
          id: 'trajectory-hexes-hovered',
          type: 'fill',
          minzoom: hexMaxZoom,
          source: {
            type: 'vector',
            tiles: [`${server}/tiles/trajectories/{z}/{x}/{y}.mvt`]
          },
          'source-layer': 'trajectory-hexes-layer',
          paint: {
            'fill-opacity': trajectoryHexOpacity,
            'fill-color': {
              property: 'count',
              stops: trajectoryColorStops.current
            },
            'fill-outline-color': '#B29CDD'
          },
          filter: ['in', 'pk', '']
        },
        'points'
      )

      // Purely visual white casing under the points so they stay readable
      // over the trajectory hex fills; all interaction stays on 'points',
      // which keeps its invisible wide-stroke hit area.
      map.current.addLayer(
        {
          id: 'points-halo',
          type: 'circle',
          minzoom: hexMaxZoom,
          source: {
            type: 'vector',
            tiles: [tileQuery]
          },
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

        source: {
          type: 'vector',
          tiles: [tileQuery]
        },
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

        source: {
          type: 'vector',
          tiles: [`${server}/tiles/{z}/{x}/{y}.mvt`]
        },
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
        source: {
          type: 'vector',
          tiles: [`${server}/tiles/{z}/{x}/{y}.mvt`]
        },
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
        source: {
          type: 'vector',
          tiles: [`${server}/tiles/{z}/{x}/{y}.mvt`]
        },
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
          // near-invisible fill: the hover/click hit area
          paint: { 'fill-color': '#52a79b', 'fill-opacity': 0.07 }
        },
        'points-highlighted'
      )
      map.current.addLayer(
        {
          id: 'griddap-coverage-line',
          type: 'line',
          source: 'griddap-coverage',
          paint: {
            'line-color': '#52a79b',
            'line-width': 1.5,
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
        tiles: [
          buildTracksTileUrl(
            query,
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
          // circles never collided; keep every head visible
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
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
      // Line features render the (optionally smoothed) path; point features
      // are ALWAYS the raw fixes, so smoothing is visibly cosmetic.
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

    const handleMapTrajectoryHexesOnClick = (e) => {
      e.originalEvent.preventDefault()
      // 'points' renders on top of 'trajectory-hexes' at the same zoom
      // range — let its own click handler manage the click when the
      // cursor is directly over a point.
      if (
        map.current.queryRenderedFeatures(e.point, { layers: ['points'] })
          .length > 0
      ) {
        return
      }
      if (!creatingPolygon.current) {
        const hexFeature = e.features[0]
        const trajectoryDatasetPks = JSON.parse(hexFeature.properties.datasets)

        // Non-trajectory (profile/obis) datasets don't have their own hex
        // feature at this zoom — they render as individual 'points' — so
        // pull in whichever of those currently-rendered points fall inside
        // this hex's boundary too.
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
        const nonTrajectoryDatasetPks = pointsWithinHex.features.flatMap(
          (feature) => JSON.parse(feature.properties.datasets)
        )

        const hexDatasetPks = new Set([
          ...trajectoryDatasetPks,
          ...nonTrajectoryDatasetPks
        ])
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

    map.current.on('mousemove', 'trajectory-hexes', (e) => {
      // 'points' renders on top of 'trajectory-hexes' at the same zoom
      // range — defer to its own mousemove/tooltip when the cursor is
      // directly over a point, instead of clobbering it here.
      if (
        !draw.getMode().includes('draw') &&
        map.current.queryRenderedFeatures(e.point, { layers: ['points'] })
          .length === 0
      ) {
        map.current.getCanvas().style.cursor = 'pointer'
        const coordinates = [e.lngLat.lng, e.lngLat.lat]
        const description = e.features[0].properties.count

        popup
          .setLngLat(coordinates)
          .setHTML(description + t('mapTrajectoryHexHoverTooltip'))
          .addTo(map.current)
      }
    })

    map.current.on('mouseleave', 'trajectory-hexes', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
      }
    })

    ;['track-heads', 'track-heads-fixed'].forEach((layerId) => {
      map.current.on('mousemove', layerId, (e) => {
        if (!draw.getMode().includes('draw')) {
          map.current.getCanvas().style.cursor = 'pointer'
          const properties = e.features[0].properties
          const headDate = properties.head_time
            ? new Date(Number(properties.head_time)).toISOString().replace('T', ' ').slice(0, 16)
            : ''
          popup
            .setLngLat([e.lngLat.lng, e.lngLat.lat])
            .setHTML(
              `<div>${properties.dataset_title ? `<b>${properties.dataset_title}</b><br/>` : ''}${properties.trajectory_id}${headDate ? `<br/>${headDate}` : ''}</div>`
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
              `<div>${properties.dataset_title ? `<b>${properties.dataset_title}</b><br/>` : ''}${properties.trajectory_id}${fixDate ? `<br/>${fixDate}` : ''}</div>`
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
      // heads sit above lines; let their own tooltip win
      if (
        !draw.getMode().includes('draw') &&
        map.current.queryRenderedFeatures(e.point, {
          layers: ['track-heads', 'track-heads-fixed']
        }).length === 0
      ) {
        map.current.getCanvas().style.cursor = 'pointer'
        popup
          .setLngLat([e.lngLat.lng, e.lngLat.lat])
          .setHTML(`<div><b>${e.features[0].properties.trajectory_id}</b></div>`)
          .addTo(map.current)
      }
    })

    map.current.on('mouseleave', 'track-lines', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
      }
    })

    // Griddap coverage rectangles sit under the point/hex layers — defer to
    // those layers' own handlers whenever one of their features is under the
    // cursor (same pattern as trajectory-hexes above).
    const griddapFeatureIsCovered = (e) =>
      map.current.queryRenderedFeatures(e.point, {
        layers: ['points', 'hexes'].filter((layer) => map.current.getLayer(layer))
      }).length > 0

    map.current.on('mousemove', 'griddap-coverage-fill', (e) => {
      if (draw.getMode().includes('draw') || griddapFeatureIsCovered(e)) return
      map.current.getCanvas().style.cursor = 'pointer'
      // nested feature properties arrive JSON-stringified from MapLibre
      let title = ''
      try {
        const titleTranslated = JSON.parse(
          e.features[0].properties.title_translated
        )
        title = titleTranslated[i18n.language] || titleTranslated.en || ''
      } catch (error) {
        title = e.features[0].properties.dataset_id || ''
      }
      popup
        .setLngLat([e.lngLat.lng, e.lngLat.lat])
        .setHTML(`<div>${title}<br/>${t('griddapCoverageTooltip')}</div>`)
        .addTo(map.current)
    })

    map.current.on('mouseleave', 'griddap-coverage-fill', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
      }
    })

    const handleGriddapCoverageOnClick = (e) => {
      if (griddapFeatureIsCovered(e)) return
      e.originalEvent.preventDefault()
      if (!creatingPolygon.current) {
        const clickedPk = e.features[0].properties.pk
        // Same mechanism as the trajectory-hex click: narrow the dataset
        // selection to the clicked dataset, which makes /pointQuery return
        // one row and SelectionDetails auto-open its inspector.
        setDatasetsSelected((previousDatasetsSelected) =>
          previousDatasetsSelected.map((dataset) => ({
            ...dataset,
            isSelected: dataset.pk === clickedPk
          }))
        )
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

    map.current.on('idle', (e) => {
      layersLoaded.current = true
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
    map.current.on('moveend', (e) => {
      const center = map.current.getCenter()
      setMapView({
        lat: center.lat,
        lon: center.lng,
        zoom: map.current.getZoom()
      })
    })
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

    map.current.on('click', 'trajectory-hexes', handleMapTrajectoryHexesOnClick)
    map.current.on('touchend', 'trajectory-hexes', handleMapTrajectoryHexesOnClick)

    map.current.on('click', 'griddap-coverage-fill', handleGriddapCoverageOnClick)
    map.current.on('touchend', 'griddap-coverage-fill', handleGriddapCoverageOnClick)

    map.current.on('click', handleMapOnClick)
    // mobile seems better without handleMapOnClick enabled for touch

    const scale = new ScaleControl({
      maxWidth: 150,
      unit: 'metric'
    })

    // Aggregates the per-source attributions from the basemap style
    // (EMODnet / GEBCO / OSM + OpenFreeMap).
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
  }, [rangeLevels, trajectoryRangeLevels])

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
