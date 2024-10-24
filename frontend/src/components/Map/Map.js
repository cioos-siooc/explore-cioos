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
  updateMapToolTitleLanguage
} from '../../utilities'
import { colorScale, defaultQuery } from '../config'
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
  hoveredDataset,
  setHoveredDataset
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
    }
  }
  const smallCircleSize = 2.75
  const largeCircleSize = 6
  const circleOpacity = 0.7
  const hexOpacity = 0.8
  const hexMinZoom = 0
  const hexMaxZoom = 7

  const draw = new MapboxDraw(drawControlOptions)
  const drawPolygon = useRef(draw)
  const doFinalCheck = useRef(false)
  const layersLoaded = useRef(false)
  const colorStops = useRef([])

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
  }, [rangeLevels])

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
    if (map.current) {
      colorStops.current = generateColorStops(
        colorScale,
        getCurrentRangeLevel(rangeLevels, map.current.getZoom())
      ).map((colorStop) => {
        return [colorStop.stop, colorStop.color]
      })
      if (colorStops.current.length > 0) {
        if (map.current.getZoom() >= 7 && map.current.getLayer('points')) {
          map.current.setPaintProperty('points', 'circle-color', colors)
        } else if (map.current.getZoom() < 7 && map.current.getLayer('hexes')) {
          map.current.setPaintProperty('hexes', 'fill-color', {
            property: 'count',
            stops: colorStops.current
          })
        }
      }
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
    const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt${
      query !== defaultQuery && q && `?${q}`
    }`
    setPointsToReview()
    setPolygon()
    if (map && map.current && map.current.loaded()) {
      map.current.setFilter('points-highlighted', ['in', 'pk', ''])

      map.current.getSource('points').tiles = [tileQuery]
      map.current.getSource('hexes').tiles = [tileQuery]

      // Remove the tiles for a particular source
      map.current.style.sourceCaches.hexes.clearTiles()
      map.current.style.sourceCaches.points.clearTiles()

      // Load the new tiles for the current viewport (map.transform -> viewport)
      map.current.style.sourceCaches.hexes.update(map.current.transform)
      map.current.style.sourceCaches.points.update(map.current.transform)

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

      const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt${
        query !== defaultQuery && q && `?${q}`
      }`

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

  return <div ref={mapContainer} className='map' />
}
