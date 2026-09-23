// Encode e2e/support/syntheticScene.js into the z7 tiles the marker and track
// specs replay. Hand-built rather than recorded: the recorded set is z2 hexes
// only, and re-recording would have to come from a database whose datasets
// match every other fixture.
//
//   node e2e/build-synthetic-tiles.mjs
//
// Tiles are written with the same layer names the API serves: the markers into
// /tiles' 'internal-layer-name', the tracks into /tiles/tracks' 'track-lines'
// and 'track-heads' (a head at each track's end, heading east).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { geoJSONToTile } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";

import { MARKERS, TRACKS, lngLatAt } from "./support/syntheticScene.js";

const TILES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/tiles");
const Z = 7;

const collection = (features) => ({ type: "FeatureCollection", features });

const markers = collection(
  MARKERS.map(({ at, properties }) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: lngLatAt(at) },
    properties,
  })),
);
const lines = collection(
  TRACKS.map(({ from, to, properties }) => ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [lngLatAt(from), lngLatAt(to)],
    },
    properties,
  })),
);
const heads = collection(
  TRACKS.map(({ to, properties }) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: lngLatAt(to) },
    properties: {
      ...properties,
      head_time: properties.time_max,
      profile_id: "",
      cog: 90,
    },
  })),
);

const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** Z,
  );
};

const coordinates = [...markers.features, ...lines.features].flatMap(
  ({ geometry }) =>
    geometry.type === "Point" ? [geometry.coordinates] : geometry.coordinates,
);
const xs = coordinates.map(([lon]) => tileX(lon));
const ys = coordinates.map(([, lat]) => tileY(lat));

const write = async (kind, x, y, layers) => {
  const tiles = Object.fromEntries(
    Object.entries(layers)
      .map(([name, data]) => [name, geoJSONToTile(data, Z, x, y)])
      .filter(([, tile]) => tile),
  );
  if (Object.keys(tiles).length === 0) return;
  const path = join(TILES, kind, `${Z}-${x}-${y}.mvt`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, fromGeojsonVt(tiles));
  console.log("  wrote", path);
};

for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    await write("tiles", x, y, { "internal-layer-name": markers });
    await write("tiles-tracks", x, y, {
      "track-lines": lines,
      "track-heads": heads,
    });
  }
}
