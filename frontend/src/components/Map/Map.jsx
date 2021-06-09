import { Map, GeolocateControl } from "maplibre-gl";

export default function createMap() {
  var map = new Map({
    renderWorldCopies: false,
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
  });

  map.on("load", function () {
    console.log("test");

    map.addLayer({
      id: "internal-layer-name",
      type: "circle",

      source: {
        type: "vector",
        tiles: ["https://pac-dev2.cioos.org/ceda/tiles/{z}/{x}/{y}.mvt"],
      },
      "source-layer": "internal-layer-name",
      paint: {
        "circle-radius": 1,
        "circle-color": "#25420b",
        "circle-opacity": 0.75,
      },
    });
  });

  map.addControl(
    new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
    })
  );
}
