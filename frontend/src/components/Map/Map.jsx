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
  createDataFilterQueryString,
  generateColorStops,
  getCurrentRangeLevel,
  updateMapToolTitleLanguage,
  zoomToDatasetCamera
} from '../../utilities'
import {
  buildWmsGetMapUrl,
  clampBoundsForWms,
  intersectBoundsWithPolygonBbox,
  warpEquirectToMercator
} from '../../wmsUtilities'
import { colorScale, trajectoryColorScale } from '../config'
import platformColors from '../../components/platformColors'
import {
  applyBasemap,
  buildBasemapStyle,
  getLabelTextField,
  FIRST_LABEL_LAYER_ID,
  LABEL_LAYER_IDS
} from './basemapStyle.js'

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
  inspectDataset,
  setDatasetsSelected,
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
  // pk of the dataset the map is currently singling out (hovered in the list,
  // or the one whose page is open). Held in a ref because the map's own event
  // handlers — zoomend, sourcedata, idle — need the current value, not the one
  // captured when they were registered.
  const focusedDatasetPk = useRef(undefined)
  // Signature of the focus state last written to the map, so re-applying an
  // unchanged focus costs nothing (see hoverHighlightPoints).
  const appliedFocus = useRef('')

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
    const focusedTrajectoryPks = pk
      ? featurePksInDataset('trajectory-hexes')
      : []

    // Repainting makes the map fire the very events that re-run this, so a
    // no-op has to stay a no-op or the map spins in a render loop. The zoom
    // band is part of the signature because it decides which layer is greyed.
    const signature = JSON.stringify([
      pk,
      pointLevel,
      focusedPks,
      focusedTrajectoryPks
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

      map.current.setPaintProperty('trajectory-hexes', 'fill-color', 'lightgrey')
      map.current.setFilter('trajectory-hexes-hovered', [
        'in',
        'pk',
        ...focusedTrajectoryPks
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
    'trajectory-hexes-hovered'
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
          map.current.getLayer('trajectory-hexes') ? 'trajectory-hexes' : undefined
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

  useEffect(() => {
    const q = createDataFilterQueryString(query)
    const filterSuffix = q ? `?${q}` : ''
    const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt${filterSuffix}`
    const trajectoryTileQuery = `${server}/tiles/trajectories/{z}/{x}/{y}.mvt${filterSuffix}`
    setPointsToReview()
    setPolygon()
    if (map && map.current && map.current.loaded()) {
      map.current.setFilter('points-highlighted', ['in', 'pk', ''])

      // Swap the tile URLs (with the new filter query) and re-render via the
      // public setTiles API — it clears the source's tile cache and reloads
      // the viewport tiles internally.
      map.current.getSource('points').setTiles([tileQuery])
      map.current.getSource('points-halo').setTiles([tileQuery])
      map.current.getSource('hexes').setTiles([tileQuery])
      map.current.getSource('trajectory-hexes').setTiles([trajectoryTileQuery])
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

      const q = createDataFilterQueryString(query)
      const filterSuffix = q ? `?${q}` : ''

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

    // New tiles — a filter change, or the camera moving into fresh data —
    // arrive as features the focus filters were never computed against (they
    // come from queryRenderedFeatures, a snapshot of whatever was on screen at
    // the time). Re-apply the focus as soon as each data source finishes
    // loading, so the unselected datasets are already grey on the first frame
    // of the new data instead of only after the next hover.
    const dataSourceIds = ['points', 'points-halo', 'hexes', 'trajectory-hexes']
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
