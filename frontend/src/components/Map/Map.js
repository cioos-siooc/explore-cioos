import * as React from "react"
import maplibreGl, { NavigationControl, Popup } from "maplibre-gl"
import MapboxDraw from "@mapbox/mapbox-gl-draw"
import { useState, useEffect, useRef } from "react"
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
export default function CreateMap({ query, setSelectedPointPKs}) {
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
      setSelectedPointPKs(undefined)
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
        
        // Ensure that if the map is zoomed out such that multiple
        // copies of the feature are visible, the popup appears
        // over the copy being pointed to.
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360
        }
        
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
    })

    setMapSetupComplete(true)
  })

  return (
    <div ref={mapContainer} className="map" />
  )
}
  /*
    const [tooltipTimeout, setTooltipTimeout] = useState()
    const [hoveredPointDetails, setHoveredPointDetails] = useState()
    const [clickedPointDetails, setClickedPointDetails] = useState()
    const [popup, setPopup] = useState(new Popup({
      closeButton: false,
      closeOnClick: true,
      maxWidth: '400px'
      }))
    // const canvas = this.map.getCanvasContainer()
    // this.canvas.style.cursor = 'grab'

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

    map.addControl(new NavigationControl(), "bottom-right")
    map.addControl(drawPolygon, "bottom-right")
    // const query = {
    //   timeMin: "1900-01-01",
    //   timeMax: new Date().toLocaleDateString(),
    //   depthMin: 0,
    //   depthMax: 12000,
    //   eovs: ["carbon", "currents", "nutrients", "salinity", "temperature"],
    //   dataType: ["casts", "fixedStations"],
    // }
    map.on("load", (query) => {
      console.log(query)
      const queryString = Object.entries(query)
        .map(([k, v]) => `${k}=${v}`)
        .join("&")

      map.addLayer({
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

      map.addLayer({
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

      map.addLayer({
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

      map.on('click', e => {
        map.setFilter('points-highlighted', ['in', 'pk', ''])
        clickedPointDetails = undefined
      })

      map.on('click', 'points', e => {
        clickedPointDetails = e.features
        var bbox = [
          [e.point.x, e.point.y],
          [e.point.x, e.point.y]
        ]
        var features = map.queryRenderedFeatures(bbox, {
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
        map.setFilter('points-highlighted', filter)
      })

      map.on('mouseenter', "points", e => {
        // this.canvas.style.cursor = 'pointer'
        hoveredPointDetails = e
        tooltipTimeout = setTimeout(() => createTooltip(), 300)
      })

      map.on('mouseleave', 'points',  () => {
        // this.canvas.style.cursor = 'grab'
        clearTimeout(tooltipTimeout)
        hoveredPointDetails = undefined
        popup.remove()
      })

      map.on('mousemove', "hexes", e => {
        var coordinates = [e.lngLat.lng, e.lngLat.lat]
        var description = e.features[0].properties.count
        
        // Ensure that if the map is zoomed out such that multiple
        // copies of the feature are visible, the popup appears
        // over the copy being pointed to.
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360
        }
        
        popup
        .setLngLat(coordinates)
        .setHTML(description + " records")
        .addTo(map)
      })

      map.on('mouseleave', 'hexes',  () => {
        popup.remove()
      })

      map.on('draw.create', e => { // Ensure there are only one polygons on the map at a time
        if(drawPolygon.getAll().features.length > 1) {
          drawPolygon.delete(drawPolygon.getAll().features[0].id)
        }
      })

      map.on('touchend', e => {
        map.setFilter('points-highlighted', ['in', 'pk', ''])
        clickedPointDetails = undefined
      })

      map.on('touchend', 'points', e => {
        if (e.points.length !== 1) return
         
        clickedPointDetails = e.features
        var bbox = [
          [e.point.x, e.point.y],
          [e.point.x, e.point.y]
        ]
        var features = map.queryRenderedFeatures(bbox, {
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
        map.setFilter('points-highlighted', filter)
      })
    })
  

  function createTooltip() {
    if(hoveredPointDetails !== undefined && hoveredPointDetails.features !== undefined) {
      // When a click event occurs on a feature in the places layer, open a popup at the
      // location of the feature, with description HTML from its properties.
      var coordinates = hoveredPointDetails.features[0].geometry.coordinates.slice()
      popup
        .setLngLat(coordinates)
        .setHTML(
          ` <div>
              ${hoveredPointDetails.features[0].properties.count} records. Click for details
            </div> 
          `
        )
        .addTo(map)
    }
  }

  // function getLoaded() {
  //   return map.loaded()
  // }

  // function getPointClicked() {
  //   return clickedPointDetails
  // }

  // function getPolygon() {
  //   const currentFeatures = drawPolygon.getAll().features[0]
  //   if(currentFeatures) {
  //     return currentFeatures.geometry.coordinates[0]
  //   }
  // }

  function createDataFilterQueryString(query) {
    let eovsArray = [], orgsArray = []
    const apiMappedQuery = {
      timeMin: query.startDate,
      timeMax: query.endDate,
      depthMin: query.startDepth,
      depthMax: query.endDepth,
      eovs: Object.keys(query.eovsSelected).forEach((eov) => {
        if(query.eovsSelected[eov]) {
          eovsArray.push(eov)
        }
      }),
      organizations: Object.keys(query.orgsSelected).forEach((org) => {
        if(query.orgsSelected[org]) {
          orgsArray.push(org)
        }
      })
    }
    return Object.entries(apiMappedQuery).filter(([k, v]) => v).map(([k, v]) => `${k}=${v}`).join("&")
  }

  function updateQuery(query) {
    map.setFilter('points-highlighted', ['in', 'pk', ''])
    const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt?${createDataFilterQueryString(query)}`

    map.getSource("points").tiles = [tileQuery]
    map.getSource("hexes").tiles = [tileQuery]
    
    // Remove the tiles for a particular source
    map.style.sourceCaches["hexes"].clearTiles()
    map.style.sourceCaches["points"].clearTiles()

    // Load the new tiles for the current viewport (map.transform -> viewport)
    map.style.sourceCaches["hexes"].update(map.transform)
    map.style.sourceCaches["points"].update(map.transform)

    // Force a repaint, so that the map will be repainted without you having to touch the map
    map.triggerRepaint()
  }
  
}*/
