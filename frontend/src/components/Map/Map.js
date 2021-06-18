import { Map, NavigationControl, Popup } from "maplibre-gl";
// import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import React from "react";
const server = "https://pac-dev2.cioos.org/ceda";
// const server = "http://localhost:3000";
const config = {
  fillOpacity: 0.8,
  colorScale: ["#ffffD9", "#50BAC3", "#1A468A"],
};

export default class CIOOSMap extends React.Component {
  constructor(props) {
    super(props)
    this.layerId = "data-layer";
    this.sourceId = "sourceID";
    this.counter = 0;
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

    const drawPolygon = new MapboxDraw(drawControlOptions);

    // this.map.on('draw.create', function (e) {
    //   setPolygonPresent(true)
    // });

    // this.map.on('draw.delete', function (e) {
    //   const polygons = drawPolygon.getAll()
    //   if (polygons.length === 0) {
    //     setPolygonPresent(false)
    //   }
    // })

    this.map.addControl(drawPolygon, "top-left");
    this.map.addControl(new NavigationControl(), "bottom-left");
    const query = {
      timeMin: "1900-01-01",
      timeMax: "2021-12-01",
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
          "circle-color": "orange",
          "circle-opacity": 0.8,
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
              [0, 3],
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
          "fill-opacity": 0.5,
          "fill-color": {
            property: "count",
            stops: [
              [0, config.colorScale[0]],
              [50, config.colorScale[1]],
              [100, config.colorScale[2]],
            ],
          },
        },
      });

      // Create a popup, but don't add it to the map yet.
var popup = new Popup({
  closeButton: false,
  closeOnClick: false
  });

            // When a click event occurs on a feature in the places layer, open a popup at the
        // location of the feature, with description HTML from its properties.
        this.map.on('mouseenter', "points", e => {
          console.log(e)
            var coordinates = e.features[0].geometry.coordinates.slice();
            var description = e.features[0].properties.count;
            
            // Ensure that if the map is zoomed out such that multiple
            // copies of the feature are visible, the popup appears
            // over the copy being pointed to.
            while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
            }
            
           popup
            .setLngLat(coordinates)
            .setHTML(description + " points")
            .addTo(this.map);
          });

          this.map.on('mouseleave', 'points',  () => {
            popup.remove();
            });

            this.map.on('mousemove', "hexes", e => {
              console.log(e, e.features)
              var coordinates = [e.lngLat.lng, e.lngLat.lat];
              var description = e.features[0].properties.count;
              
              // Ensure that if the map is zoomed out such that multiple
              // copies of the feature are visible, the popup appears
              // over the copy being pointed to.
              while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
              coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
              }
              
             popup
              .setLngLat(coordinates)
              .setHTML(description + " points")
              .addTo(this.map);
            });

            this.map.on('mouseleave', 'hexes',  () => {
              popup.remove();
              });
     
    });
  }

  getLoaded() {
    return this.map.loaded();
  }

  getPolygon() {
    console.log("get polygon");
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
    this.map.getSource("points").tiles = [
      `${server}/tiles/{z}/{x}/{y}.mvt?${queryString}`,
    ];
    this.map.getSource("hexes").tiles = [
      `${server}/tiles/{z}/{x}/{y}.mvt?isHexGrid=true&${queryString}`,
    ];
    // console.log(this.map);
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
