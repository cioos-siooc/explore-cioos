import * as React from "react"
import maplibreGl, { NavigationControl, Popup } from "maplibre-gl"
import MapboxDraw from "@mapbox/mapbox-gl-draw"
import { useState, useEffect, useRef } from "react"
import * as turf from '@turf/turf'

import './styles.css'

import {server} from '../../config'

const config = {
  fillOpacity: 0.8,
  // colorScale: ["#DDF3DF",  "#B0E1C8" , "#85CDC4" , "#5CA2B8" , "#4B719B", "#3B487E", "#302B5F"],
  // colorScale: ["#D2F4F0","#BDE7E2","#A7DAD4","#92CEC6","#7DC1B7","#67B4A9", "#52A79B"]
  // colorScale: ["#bbddd8","#9fd0c9","#76bcb2","#52a79b","#4a968c","#3d7b73", "#2f6059"]
  colorScale: ["#52A79B","#4A968C","#3D7B73","#2F6059","#224440","#1B3733", "#142926"]
}

// Using Maplibre with React: https://documentation.maptiler.com/hc/en-us/articles/4405444890897-Display-MapLibre-GL-JS-map-using-React-JS
export default function CreateMap({ query, setSelectedPointPKs, setPolygon}) {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const [mapSetupComplete, setMapSetupComplete] = useState(false)
  const [organizations, setOrganizations] = useState()
  const [zoom, setZoom] = useState(2)

  const popup= new Popup({
    closeButton: false,
    closeOnClick: true,
    maxWidth: '400px'
  })

  useEffect(() => {
    setSelectedPointPKs()
  }, [query])

  useEffect(() => {
    fetch(`${server}/organizations`).then(response => response.json()).then(data => {
      let orgsReturned = {}
      data.forEach(elem => {
        orgsReturned[elem.name] = elem.pk
      })
      setOrganizations(orgsReturned)
    }).catch(error => { throw error })
  }, [])

  function createDataFilterQueryString(query) {
    let eovsArray = [], orgsArray = []
    Object.keys(query.eovsSelected).forEach((eov) => {
      if(query.eovsSelected[eov]) {
        eovsArray.push(eov)
      }
    })
    Object.keys(query.orgsSelected).forEach((org) => {
      if(query.orgsSelected[org]) {
        orgsArray.push(organizations[org])
      }
    })
    let apiMappedQuery = {
      timeMin: query.startDate,
      timeMax: query.endDate,
      depthMin: query.startDepth,
      depthMax: query.endDepth,
    }
    if(eovsArray.length === 0) {
      apiMappedQuery.eovs = "carbon,currents,nutrients,salinity,temperature"
    } else {
      apiMappedQuery.eovs = eovsArray
    }
    if(orgsArray.length !== 0) {
      apiMappedQuery.organizations = orgsArray
    }
    apiMappedQuery.dataType = 'casts,fixedStations'
    return Object.entries(apiMappedQuery).map(([k, v]) => `${k}=${v}`).join("&")
  }

  useEffect(() => {
    if(map && map.current && map.current.loaded()){
      map.current.setFilter('points-highlighted', ['in', 'pk', ''])
      const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt?${createDataFilterQueryString(query)}`
  
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

    // Add controls
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
    const drawPolygon = new MapboxDraw(drawControlOptions)

    // Called order determines stacking order
    map.current.addControl(new NavigationControl(), "bottom-right")
    map.current.addControl(drawPolygon, "bottom-right")

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
            1,
            config.colorScale[0],
            3,
            config.colorScale[1],
            9,
            config.colorScale[2],
            27,
            config.colorScale[3],
            81,
            config.colorScale[4],
            243,
            config.colorScale[5],
            729,
            config.colorScale[6],
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
          "fill-opacity": 0.7,
          "fill-color": {
            property: "count",
            stops: [
              [1, config.colorScale[0]],
              [3, config.colorScale[1]],
              [9, config.colorScale[2]],
              [27, config.colorScale[3]],
              [81, config.colorScale[4]],
              [243, config.colorScale[5]],
              [729, config.colorScale[6]],
            ],
          },
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
      map.current.setFilter('points-highlighted', ['in', 'pk', ''])
      setSelectedPointPKs()
      setPolygon()
    })

    map.current.on('click', 'points', e => {
      map.current.flyTo({center: [e.lngLat.lng, e.lngLat.lat]})
      setSelectedPointPKs(e.features.map(point => point.properties.pk))
      var bbox = [
        [e.point.x, e.point.y],
        [e.point.x, e.point.y]
      ]
      var features = map.current.queryRenderedFeatures(bbox, {
        layers: ['points']
      })
      
      // Run through the selected features and set a filter
      // to match features with unique ids to activate
      // the `points-selected' layer.
      var filter = features.reduce(
        function (memo, feature) {
          memo.push(feature.properties.pk)
          return memo
        },
        ['in', 'pk']
        )
      map.current.setFilter('points-highlighted', filter)
      drawPolygon.delete(drawPolygon.getAll().features[0].id)
      setPolygon(bbox)
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
              ${e.features[0].properties.count} points. Click for details
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
        .setHTML(description + " points")
        .addTo(map.current)
    })

    map.current.on('mouseleave', 'hexes',  () => {
        popup.remove()
    })

    map.current.on('draw.create', e => { 
      // Ensure there are only one polygons on the map at a time
      if(drawPolygon.getAll().features.length > 1) {
        drawPolygon.delete(drawPolygon.getAll().features[0].id)
      }

      const polygon = drawPolygon.getAll().features[0].geometry.coordinates[0]
      setPolygon(polygon)
      
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
      })//turf.point(point.geometry.coordinates,point.properties))

      const featureCollection = {type: 'FeatureCollection', features: features}
      console.log('rendered points on map', featureCollection)

      var points = turf.points([
        [-46.6318, -23.5523],
        [-46.6246, -23.5325],
        [-46.6062, -23.5513],
        [-46.663, -23.554],
        [-46.643, -23.557]
    ], {test: 'test'});
    
    console.log('points', points, 'featureCollection', featureCollection)

    var searchWithin = turf.polygon([polygon]);
    
    var pointsWithinPolygon = turf.pointsWithinPolygon(featureCollection, searchWithin);

      console.log('points that are within the polygon', pointsWithinPolygon)
    })

    map.current.on('draw.update', e => {
      console.log('update polygon', polygon)
      setPolygon(drawPolygon.getAll().features[0].geometry.coordinates[0])
    })

    map.current.on('draw.delete', e => {
      setPolygon()
    })

    setMapSetupComplete(true)
  })

  return (
    <div ref={mapContainer} className="map" />
  )
}
