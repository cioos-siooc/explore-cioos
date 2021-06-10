import { Map, NavigationControl } from "maplibre-gl";
// import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import React from "react";

export default class CIOOSMap extends React.Component {
  constructor(props) {
    super(props)
    this.layerId = 'data-layer'
    this.counter = 0
    this.map = new Map({
      container: "map",
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
      center: [-100, 49], // starting position
      zoom: 3 // starting zoom
    })
    
    const drawPolygon = new MapboxDraw();
    
    this.map.addControl(drawPolygon, "top-left");
    this.map.addControl(new NavigationControl(), "bottom-left");

    this.map.on('load', () => this.addDataLayer({
      timeMin: "2000-01-01",
      timeMax: "2021-12-01",
      eovs: ["oxygen", 'seaSurfaceSalinity'],
      // dataType: "Profile",
    }))
  }

  getLoaded() {
    console.log(this.map.loaded())
    return this.map.loaded()
  }

  getLayer(id) {
    return this.map.getLayer(id)
  }

  removeLayer(id) {
    return this.map.removeLayer(id)
  }
  updateSource (query) {
    const queryString = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

    this.map.getSource('')
  }
  addDataLayer(query) {
    console.log("load data called");
    const queryString = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
    console.log('querystring', queryString);
    
    // console.log('getlayer1', this.map.getLayer(this.layerId))
    // if(this.map.getLayer(this.layerId)){
    //   this.map.removeLayer(this.layerId)
    // }
    this.map.addLayer({
      id: this.layerId,
      type: "circle",
      
      source: {
        type: "vector",
        tiles: [`https://pac-dev2.cioos.org/ceda/tiles/{z}/{x}/{y}.mvt?${queryString}`],
        
        // tiles: [`http://localhost:3000/tiles/{z}/{x}/{y}.mvt?${queryString}`],
      },
      "source-layer": "internal-layer-name",
      paint: {
        "circle-radius": 1,
        "circle-color": "#25420b",
        "circle-opacity": 0.75,
      },
    });
    // this.counter++
    // console.log('getlayer2', this.map.getLayer(this.layerId))
  }
}