import * as React from 'react'
import maplibreGl, {
  AttributionControl,
  NavigationControl,
  Popup,
  ScaleControl
} from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { useState, useEffect, useRef } from 'react'

import * as helpers from '@turf/helpers'
import turfBboxPolygon from '@turf/bbox-polygon'
import turfPointsWithinPolygon from '@turf/points-within-polygon'
import turfBbox from '@turf/bbox'

import DrawRectangle from 'mapbox-gl-draw-rectangle-mode'
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
  splitTrackRuns
} from '../../utilities'
import {
  colorScale,
  trajectoryColorScale,
  trackLineColor,
  selectedTrackColor
} from '../config'
import platformColors from '../../components/platformColors'

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
  selectedTrajectory
}) {
  const { t } = useTranslation()

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
  // Raw (unsmoothed) selected-track response, cached so toggling smoothing
  // re-renders without re-fetching.
  const rawTrackRef = useRef(null)

  // UTC-day-snapped scrub window: [scrub date - N days, scrub date + 1 day).
  // Day snapping keeps the tile URLs stable so the server's URL-keyed tile
  // cache gets hits across scrubs and users.
  function tracksTimeWindow(scrub, trailing) {
    const MS_PER_DAY = 24 * 60 * 60 * 1000
    const end = new Date(`${scrub}T00:00:00Z`).getTime()
    const timeMax = `${new Date(end + MS_PER_DAY).toISOString().split('T')[0]}T00:00:00Z`
    const timeMin = `${new Date(end - trailing * MS_PER_DAY).toISOString().split('T')[0]}T00:00:00Z`
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
    map.current.getSource('tracks').tiles = [
      buildTracksTileUrl(activeQuery, scrub, trailing)
    ]
    map.current.style.sourceCaches.tracks.clearTiles()
    map.current.style.sourceCaches.tracks.update(map.current.transform)
    map.current.triggerRepaint()
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

  useEffect(() => {
    if (map.current) {
      hoverHighlightPoints(hoveredDataset?.pk)
    }
  }, [hoveredDataset])

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

      map.current.getSource('points').tiles = [tileQuery]
      map.current.getSource('points-halo').tiles = [tileQuery]
      map.current.getSource('hexes').tiles = [tileQuery]
      map.current.getSource('trajectory-hexes').tiles = [trajectoryTileQuery]

      // Remove the tiles for a particular source
      map.current.style.sourceCaches.hexes.clearTiles()
      map.current.style.sourceCaches.points.clearTiles()
      map.current.style.sourceCaches['points-halo'].clearTiles()
      map.current.style.sourceCaches['trajectory-hexes'].clearTiles()

      // Load the new tiles for the current viewport (map.transform -> viewport)
      map.current.style.sourceCaches.hexes.update(map.current.transform)
      map.current.style.sourceCaches.points.update(map.current.transform)
      map.current.style.sourceCaches['points-halo'].update(map.current.transform)
      map.current.style.sourceCaches['trajectory-hexes'].update(map.current.transform)

      // Force a repaint, so that the map will be repainted without you having to touch the map
      map.current.triggerRepaint()
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

  // Tracks mode: swap the trajectory hex layers for track lines/heads and
  // (re)load the scrub window's tiles.
  useEffect(() => {
    tracksModeRef.current = tracksMode
    if (!map.current || !map.current.getLayer('track-lines')) return
    const trackVisibility = tracksMode ? 'visible' : 'none'
    const hexVisibility = tracksMode ? 'none' : 'visible'
    ;['track-lines', 'track-heads'].forEach((id) =>
      map.current.setLayoutProperty(id, 'visibility', trackVisibility)
    )
    ;['trajectory-hexes', 'trajectory-hexes-hovered'].forEach((id) =>
      map.current.setLayoutProperty(id, 'visibility', hexVisibility)
    )
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
          map.current.setPaintProperty('track-heads', 'circle-color', trackLineColor)
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
      const fixFeatures = rawCoordinates.map((coordinate) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coordinate },
        properties: {}
      }))
      source.setData({
        type: 'FeatureCollection',
        features: [...lineFeatures, ...fixFeatures]
      })

      if (map.current.getLayer('track-lines')) {
        map.current.setPaintProperty('track-lines', 'line-color', 'lightgrey')
        map.current.setPaintProperty('track-heads', 'circle-color', 'lightgrey')
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
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            // tiles: ['https://process.oceangns.com/img?id=20220915T170823-757_oceanmappy_374&field=SST&model=CIOPS&dir=CIOPS_SST_20220916_12&z=2&x=3&y=0&minOrg=-2&step=0.1&stop=-2&stop=0&stop=0.1&stop=10&stop=10.1&stop=20&stop=20.1&stop=30&stop=30.1&stop=35&color=cc00cc&color=ff99ff&color=0066cc&color=66ffcc&color=009933&color=ccff66&color=ffff00&color=ff9933&color=ff0000&color=ffcccc&dt=1663349145779'],
            // tiles: ['https://process.oceangns.com/mapTiles/Bathymetry/SRTM/tiles/filledValue/{z}/{x}/{y}.png'],
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm'
          }
        ]
      },
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

      const q = createDataFilterQueryString(query)
      const filterSuffix = q ? `?${q}` : ''

      const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt${filterSuffix}`

      const trajectoryTileQuery = `${server}/tiles/trajectories/{z}/{x}/{y}.mvt${filterSuffix}`

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
      })

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
      })

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
      })

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
      })

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
      })

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
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1, 10, 2.5]
        }
      })

      map.current.addLayer({
        id: 'track-heads',
        type: 'circle',
        source: 'tracks',
        'source-layer': 'track-heads',
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
        filter: ['==', '$type', 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': selectedTrackColor,
          'line-width': 3
        }
      })

      map.current.addLayer({
        id: 'selected-track-fixes',
        type: 'circle',
        source: 'selected-track',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 3,
          'circle-stroke-color': selectedTrackColor,
          'circle-stroke-width': 1.5
        }
      })

      // If tracks mode was restored from the URL, hide the hex layers now.
      if (tracksModeRef.current) {
        map.current.setLayoutProperty('trajectory-hexes', 'visibility', 'none')
        map.current.setLayoutProperty(
          'trajectory-hexes-hovered',
          'visibility',
          'none'
        )
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

    map.current.on('mousemove', 'track-heads', (e) => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'pointer'
        const properties = e.features[0].properties
        const headDate = properties.head_time
          ? new Date(Number(properties.head_time)).toISOString().split('T')[0]
          : ''
        popup
          .setLngLat([e.lngLat.lng, e.lngLat.lat])
          .setHTML(
            `<div><b>${properties.trajectory_id}</b>${headDate ? `<br/>${headDate}` : ''}</div>`
          )
          .addTo(map.current)
      }
    })

    map.current.on('mouseleave', 'track-heads', () => {
      if (!draw.getMode().includes('draw')) {
        map.current.getCanvas().style.cursor = 'grab'
        popup.remove()
      }
    })

    map.current.on('mousemove', 'track-lines', (e) => {
      // heads sit above lines; let their own tooltip win
      if (
        !draw.getMode().includes('draw') &&
        map.current.queryRenderedFeatures(e.point, { layers: ['track-heads'] })
          .length === 0
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

    map.current.on('click', handleMapOnClick)
    // mobile seems better without handleMapOnClick enabled for touch

    const scale = new ScaleControl({
      maxWidth: 150,
      unit: 'metric'
    })

    const attribution = new AttributionControl({
      customAttribution:
        'Map tiles by <a href="http://stamen.com">Stamen Design</a>, under <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a>. Data by <a href="http://openstreetmap.org">OpenStreetMap</a>, under <a href="http://creativecommons.org/licenses/by-sa/3.0">CC BY SA</a>.'
      // compact: true
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

  return <div ref={mapContainer} className='map' />
}
