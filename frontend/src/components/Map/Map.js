import { Map, NavigationControl, Popup } from "maplibre-gl";
// import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import React from "react";
import './styles.css'

import {server} from '../../config'

const config = {
  fillOpacity: 0.8,
  // colorScale: ["#DDF3DF",  "#B0E1C8" , "#85CDC4" , "#5CA2B8" , "#4B719B", "#3B487E", "#302B5F"],
  // colorScale: ["#D2F4F0","#BDE7E2","#A7DAD4","#92CEC6","#7DC1B7","#67B4A9", "#52A79B"]
  // colorScale: ["#bbddd8","#9fd0c9","#76bcb2","#52a79b","#4a968c","#3d7b73", "#2f6059"]
  colorScale: ["#52A79B","#4A968C","#3D7B73","#2F6059","#224440","#1B3733", "#142926"]


};

export default class CIOOSMap extends React.Component {
  constructor(props) {
    super(props)
    this.layerId = "data-layer";
    this.sourceId = "sourceID";
    this.counter = 0;
    this.tooltipTimeout
    this.hoveredPointDetails
    this.clickedPointDetails 
    this.popup = new Popup({
      closeButton: false,
      closeOnClick: true,
      maxWidth: '400px'
      });
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
      center: [-106, 56], // starting position
      zoom: 2, // starting zoom
    });
    this.canvas = this.map.getCanvasContainer()
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

    this.drawPolygon = new MapboxDraw(drawControlOptions);

    this.map.addControl(this.drawPolygon, "top-left");
    this.map.addControl(new NavigationControl(), "bottom-left");
    const query = {
      timeMin: "1900-01-01",
      timeMax: new Date().toLocaleDateString(),
      depthMin: 0,
      depthMax: 12000,
      eovs: ["carbon", "currents", "nutrients", "salinity", "temperature"],
      dataType: ["casts", "fixedStations"],
    };
    this.map.on("load", () => {
      const queryString = Object.entries(query)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");

      this.map.addLayer({
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
          // "circle-opacity": 0.9,
          "circle-stroke-width": {
            property: "pointtype",
            stops: [
              [0, 0],
              [1, 1],
            ],
          },
          "circle-radius": {
            property: "pointtype",
            stops: [
              [0, 4],
              [1, 10],
            ],
          },
        },
      });

      this.map.addLayer({
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
      });

      this.map.addLayer({
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
          "circle-stroke-width": {
            property: "pointtype",
            stops: [
              [0, 0],
              [1, 1],
            ],
          },
          "circle-radius": {
            property: "pointtype",
            stops: [
              [0, 4],
              [1, 10],
            ],
          },
        },
        filter: ['in', 'pk', '']
      });

      this.map.on('click', e => {
        this.map.setFilter('points-highlighted', ['in', 'pk', '']);
        this.clickedPointDetails = undefined
      })

      this.map.on('click', 'points', e => {
        this.clickedPointDetails = e.features
        var bbox = [
          [e.point.x, e.point.y],
          [e.point.x, e.point.y]
        ];
        var features = this.map.queryRenderedFeatures(bbox, {
          layers: ['points']
        });
          
        // Run through the selected features and set a filter
        // to match features with unique ids to activate
        // the `points-selected' layer.
        var filter = features.reduce(
          function (memo, feature) {
            memo.push(feature.properties.pk);
            return memo;
          },
          ['in', 'pk']
        );
        this.map.setFilter('points-highlighted', filter);
      })

      this.map.on('mouseenter', "points", e => {
        // this.canvas.style.cursor = 'pointer'
        this.hoveredPointDetails = e
        this.tooltipTimeout = setTimeout(() => this.createTooltip(), 300)
      })

      this.map.on('mouseleave', 'points',  () => {
        // this.canvas.style.cursor = 'grab'
        clearTimeout(this.tooltipTimeout)
        this.hoveredPointDetails = undefined
        this.popup.remove()
      })

      this.map.on('mousemove', "hexes", e => {
        var coordinates = [e.lngLat.lng, e.lngLat.lat];
        var description = e.features[0].properties.count;
        
        // Ensure that if the map is zoomed out such that multiple
        // copies of the feature are visible, the popup appears
        // over the copy being pointed to.
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }
        
        this.popup
        .setLngLat(coordinates)
        .setHTML(description + " profiles")
        .addTo(this.map);
      });

      this.map.on('mouseleave', 'hexes',  () => {
        this.popup.remove();
      });

      this.map.on('draw.create', e => { // Ensure there are only one polygons on the map at a time
        if(this.drawPolygon.getAll().features.length > 1) {
          this.drawPolygon.delete(this.drawPolygon.getAll().features[0].id)
        }
      })

      this.map.on('touchend', e => {
        this.map.setFilter('points-highlighted', ['in', 'pk', '']);
        this.clickedPointDetails = undefined
      })

      this.map.on('touchend', 'points', e => {
        if (e.points.length !== 1) return;
         
        this.clickedPointDetails = e.features
        var bbox = [
          [e.point.x, e.point.y],
          [e.point.x, e.point.y]
        ];
        var features = this.map.queryRenderedFeatures(bbox, {
          layers: ['points']
        });
          
        // Run through the selected features and set a filter
        // to match features with unique ids to activate
        // the `points-selected' layer.
        var filter = features.reduce(
          function (memo, feature) {
            memo.push(feature.properties.pk);
            return memo;
          },
          ['in', 'pk']
        );
        this.map.setFilter('points-highlighted', filter);
      })
    })
  }

  createTooltip() {
    if(this.hoveredPointDetails !== undefined && this.hoveredPointDetails.features !== undefined) {
      // When a click event occurs on a feature in the places layer, open a popup at the
      // location of the feature, with description HTML from its properties.
      var coordinates = this.hoveredPointDetails.features[0].geometry.coordinates.slice()
      this.popup
        .setLngLat(coordinates)
        .setHTML(
          ` <div>
              ${this.hoveredPointDetails.features[0].properties.count} profiles. Click for details
            </div> 
          `
        )
        .addTo(this.map)
    }
  }

  getLoaded() {
    return this.map.loaded();
  }

  getPointClicked() {
    return this.clickedPointDetails
  }

  getPolygon() {
    if (this.map.getSource("mapbox-gl-draw-cold")) {
      const polygonSource = this.map.getSource("mapbox-gl-draw-cold")
      if (polygonSource) { // there is a polygon drawn
        const polygonFeatures = polygonSource._data.features.map((elem) => elem.geometry)
        if(polygonFeatures[0]){
          return polygonFeatures[0].coordinates[0]; // get coordinates array of polygon
        }
      }
    }
  }

  updateSource(queryString) {
    this.map.setFilter('points-highlighted', ['in', 'pk', ''])
    const tileQuery = `${server}/tiles/{z}/{x}/{y}.mvt?${queryString}`;

    this.map.getSource("points").tiles = [tileQuery];
    this.map.getSource("hexes").tiles = [tileQuery];
    // Remove the tiles for a particular source
    this.map.style.sourceCaches["hexes"].clearTiles();
    this.map.style.sourceCaches["points"].clearTiles();

    // Load the new tiles for the current viewport (map.transform -> viewport)
    this.map.style.sourceCaches["hexes"].update(this.map.transform);
    this.map.style.sourceCaches["points"].update(this.map.transform);

    // Force a repaint, so that the map will be repainted without you having to touch the map
    this.map.triggerRepaint();
  }
}
