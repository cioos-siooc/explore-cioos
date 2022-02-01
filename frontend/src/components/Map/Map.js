import * as React from "react"
import maplibreGl, { NavigationControl, Popup } from "maplibre-gl"
import MapboxDraw from "@mapbox/mapbox-gl-draw"
import { useState, useEffect, useRef } from "react"
import * as turf from '@turf/turf'

import './styles.css'

import { server}  from '../../config'
import { createDataFilterQueryString, generateColorStops } from "../../utilities"
import { colorScale } from "../config"
import { set } from "lodash"

// const config = {
//   fillOpacity: 0.8,
//   // colorScale: ["#DDF3DF",  "#B0E1C8" , "#85CDC4" , "#5CA2B8" , "#4B719B", "#3B487E", "#302B5F"],
//   // colorScale: ["#D2F4F0","#BDE7E2","#A7DAD4","#92CEC6","#7DC1B7","#67B4A9", "#52A79B"]
//   // colorScale: ["#bbddd8","#9fd0c9","#76bcb2","#52a79b","#4a968c","#3d7b73", "#2f6059"]
//   colorScale: colorScale
// }

// Using Maplibre with React: https://documentation.maptiler.com/hc/en-us/articles/4405444890897-Display-MapLibre-GL-JS-map-using-React-JS
export default function CreateMap({ query, setSelectedPointPKs, setPolygon, setLoading, organizations, zoom, setZoom, currentRangeLevel }) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const drawControlOptions = {
    displayControlsDefault: false,
    controls: {
      point: false, 
      line_string: false,
      polygon: true, 
      trash: true,
      combine_features: false,
      uncombine_features: false
    }
  }
  const drawPolygon = useRef(new MapboxDraw(drawControlOptions))
  const [boxSelectStartCoords, setBoxSelectStartCoords] = useState()
  const [boxSelectEndCoords, setBoxSelectEndCoords] = useState()

  useEffect(() => {
    if(boxSelectStartCoords && boxSelectEndCoords) {
      if(drawPolygon.current.getAll().features.length > 0) {
        drawPolygon.current.delete(drawPolygon.current.getAll().features[0].id)
      }
      const lineString = turf.lineString([boxSelectStartCoords, boxSelectEndCoords])
      const bboxPolygon = turf.bboxPolygon(turf.bbox(lineString))
      setBoxSelectEndCoords()
      setBoxSelectStartCoords()
      setLoading(true)
      polygonSelection(bboxPolygon.geometry.coordinates[0])
    }
  }, [boxSelectEndCoords])

  function polygonSelection(polygon) {
    var features = map.current.queryRenderedFeatures({layers: ['points']}).map(point => {
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          // Note order: longitude, latitude.
          coordinates: point.geometry.coordinates
        },
        properties: {...point.properties}
      }
    })

    const featureCollection = {type: 'FeatureCollection', features: features}
    var searchWithin = turf.polygon([polygon]);
    var pointsWithinPolygon = turf.pointsWithinPolygon(featureCollection, searchWithin);
    
    // Filter points layer to show the points that have been selected
    var filter = pointsWithinPolygon.features.reduce(
      function (memo, feature) {
        memo.push(feature.properties.pk)
        return memo
      },
      ['in', 'pk']
    )
    
    // if(filter.length > 1000) {
    //   return window.alert('Please select 1000 or fewer features')
    // }

    map.current.setFilter('points-highlighted', filter)

    if(pointsWithinPolygon.features.map(point => point.properties.pk).length > 0){
      setSelectedPointPKs(pointsWithinPolygon.features.map(point => point.properties.pk))
    }
    
    //set selected PKs and polygon
    setPolygon(polygon)
  }

  const popup = new Popup({
    closeButton: false,
    closeOnClick: true,
    maxWidth: '400px'
  })
  
  useEffect(() => {
    setSelectedPointPKs()
    if(map && map.current && map.current.loaded()){
      map.current.setFilter('points-highlighted', ['in', 'pk', ''])
      const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt?${createDataFilterQueryString(query, organizations)}`
  
      map.current.getSource("points").tiles = [tileQuery]
      map.current.getSource("hexes").tiles = [tileQuery]
      
      // Remove the tiles for a particular source
      map.current.style.sourceCaches["hexes"].clearTiles()
      map.current.style.sourceCaches["points"].clearTiles()
  
      // Load the new tiles for the current viewport (map.transform -> viewport)
      map.current.style.sourceCaches["hexes"].update(map.current.transform)
      map.current.style.sourceCaches["points"].update(map.current.transform)
  
      // Force a repaint, so that the map will be repainted without you having to touch the map
      map.current.triggerRepaint()
      setLoading(true)
    }
  }, [query])

  useEffect(() => {
    // If already created don't proceed
    if(map.current) return
    // Create map
    map.current = new maplibreGl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              'Map tiles by <a href="http://stamen.com">Stamen Design</a>, under <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a>. Data by <a href="http://openstreetmap.org">OpenStreetMap</a>, under <a href="http://creativecommons.org/licenses/by-sa/3.0">CC BY SA</a>.',
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [-125, 49], // starting position
      zoom: zoom, // starting zoom
    })

    // Called order determines stacking order
    map.current.addControl(new NavigationControl(), "bottom-right")
    map.current.addControl(drawPolygon.current, "bottom-right")

    //
    map.current.on("load", () => {
      const query = {
        timeMin: "1900-01-01",
        timeMax: new Date().toLocaleDateString(),
        depthMin: 0,
        depthMax: 12000,
        eovs: ["carbon", "currents", "nutrients", "salinity", "temperature"],
        dataType: ["casts", "fixedStations"],
      }
      const queryString = Object.entries(query)
        .map(([k, v]) => `${k}=${v}`)
        .join("&")

      let colorStops = []
      generateColorStops(colorScale, currentRangeLevel).map(colorStop => {
        colorStops.push(colorStop.stop)
        colorStops.push(colorStop.color)
      })

      map.current.addLayer({
        id: "points",
        type: "circle",
        minzoom: 7,
        source: {
          type: "vector",
          tiles: [`${server}/tiles/{z}/{x}/{y}.mvt?${queryString}`],
        },
        "source-layer": "internal-layer-name",
        paint: {
          "circle-color":  [
            'interpolate',
            ['linear'],
            ['get', 'count'],
            ...colorStops
          ],
        },
      })

      map.current.addLayer({
        id: "hexes",
        type: "fill",
        minzoom: 0,
        maxzoom: 7,

        source: {
          type: "vector",
          tiles: [`${server}/tiles/{z}/{x}/{y}.mvt?${queryString}`],
        },
        "source-layer": "internal-layer-name",

        paint: {
          "fill-opacity": 0.8,
          "fill-color": 
          [
            'interpolate',
            ['linear'],
            ['get', 'count'],
            ...colorStops
          ],
        },
      })

      map.current.addLayer({
        id: "points-highlighted",
        type: "circle",
        minzoom: 7,
        source: {
          type: "vector",
          tiles: [`${server}/tiles/{z}/{x}/{y}.mvt?${queryString}`],
        },
        "source-layer": "internal-layer-name",
        paint: {
          "circle-color":  "red",
          "circle-opacity": 1.0,
        },
        filter: ['in', 'pk', '']
      })

    })

    map.current.on('click', e => {
      if(drawPolygon.current.getAll().features.length === 0) {
        map.current.setFilter('points-highlighted', ['in', 'pk', ''])
        setSelectedPointPKs()
      }
    })

    map.current.on('click', 'points', e => {
      map.current.flyTo({center: [e.lngLat.lng, e.lngLat.lat]})
      const height = 10
      const width = 10
      var bbox = [
        [e.point.x - width / 2, e.point.y - height / 2],
        [e.point.x + width / 2, e.point.y + height / 2]
      ]
      const cornerA = map.current.unproject(bbox[0])
      const cornerB = map.current.unproject(bbox[1])
      const clickLngLatBBox = [
        [cornerA.lng, cornerA.lat],
        [cornerB.lng, cornerB.lat]
      ]
      const lineString = turf.lineString(clickLngLatBBox)
      const bboxPolygon = turf.bboxPolygon(turf.bbox(lineString))
      polygonSelection(bboxPolygon.geometry.coordinates[0])
    })

    map.current.on('click', 'hexes', e => {
      map.current.flyTo({center: [e.lngLat.lng, e.lngLat.lat], zoom: 7})
    })

    map.current.on('mousemove', 'points', e => {
      var coordinates = e.features[0].geometry.coordinates.slice()
      popup
        .setLngLat(coordinates)
        .setHTML(
          ` <div>
              ${e.features[0].properties.count} records. Click for details
            </div> 
          `
        )
        .addTo(map.current)
    })

    map.current.on('mouseleave', 'points',  () => {
        popup.remove()
    })

    map.current.on('mousemove', "hexes", e => {
        var coordinates = [e.lngLat.lng, e.lngLat.lat]
        var description = e.features[0].properties.count
         
        popup
        .setLngLat(coordinates)
        .setHTML(description + " records. Click to zoom")
        .addTo(map.current)
    })

    map.current.on('mouseleave', 'hexes',  () => {
        popup.remove()
    })

    map.current.on('draw.create', e => {
      setSelectedPointPKs()
      setLoading(true)
      if(drawPolygon.current.getAll().features.length > 1) {
        drawPolygon.current.delete(drawPolygon.current.getAll().features[0].id)
      }
      polygonSelection(drawPolygon.current.getAll().features[0].geometry.coordinates[0])
    })

    map.current.on('draw.update', e => {
      setLoading(true)
      polygonSelection(drawPolygon.current.getAll().features[0].geometry.coordinates[0])
    })

    map.current.on('draw.delete', e => {
      map.current.setFilter('points-highlighted', ['in', 'pk', ''])
      setSelectedPointPKs()
      setPolygon()
    })

    map.current.on('idle', e => {
      setLoading(false)
    })

    map.current.on('zoomend', e => {
      if(drawPolygon.current.getAll().features.length > 0) {
        setSelectedPointPKs()
        if(map.current.getZoom() >= 7){
          setLoading(true)
          polygonSelection(drawPolygon.current.getAll().features[0].geometry.coordinates[0])
        }
      }
    })

    map.current.on('mousedown', e => {
      if(e.originalEvent.shiftKey) {
        setBoxSelectStartCoords([e.lngLat.lng, e.lngLat.lat])
      }
    })

    map.current.on('mouseup', e => {
      setBoxSelectEndCoords([e.lngLat.lng, e.lngLat.lat])
    })

    map.current.on('zoomend', e => {
      setZoom(map.current.getZoom())
    })
  })

  return (
    <div ref={mapContainer} className="map" />
  )
}
