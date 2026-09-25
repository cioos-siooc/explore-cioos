// Encode e2e/support/syntheticScene.js into the z7 tiles the marker and track
// specs replay. Hand-built rather than recorded: the recorded set is z2 hexes
// only, and re-recording would have to come from a database whose datasets
// match every other fixture.
//
//   node e2e/build-synthetic-tiles.mjs
//
// Tiles are written with the same layer names the API serves: the markers into
// /tiles' 'internal-layer-name', the tracks into /tiles/tracks' 'track-lines'
// and 'track-heads' (a head at each track's end, heading east). The grids are
// not tiles: /griddapCoverage is GeoJSON, written as api/griddapCoverage.json.
// api/trajectories_track.json is what a click on OPEN_TRACK fetches: its fixes
// at both ends and one in the middle, which no track head sits on.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { geoJSONToTile } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";

import {
  GRIDS,
  MARKERS,
  OPEN_TRACK,
  TRACKS,
  lngLatAt,
} from "./support/syntheticScene.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TILES = join(FIXTURES, "tiles");
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

const gridCoverage = collection(
  GRIDS.map(({ rect: [left, top, right, bottom], properties }) => ({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
          [left, top],
        ].map(lngLatAt),
      ],
    },
    properties,
  })),
);
const gridPath = join(FIXTURES, "api/griddapCoverage.json");
await writeFile(gridPath, `${JSON.stringify(gridCoverage, null, 2)}\n`);
console.log("  wrote", gridPath);

const { from, to, properties } = OPEN_TRACK;
const middle = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
const round = ([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
const trackPath = join(FIXTURES, "api/trajectories_track.json");
await writeFile(
  trackPath,
  `${JSON.stringify(
    {
      coordinates: [from, middle, to].map(lngLatAt).map(round),
      times: [
        properties.time_min,
        (properties.time_min + properties.time_max) / 2,
        properties.time_max,
      ].map((ms) => new Date(ms).toISOString()),
      profile_ids: [null, null, null],
    },
    null,
    2,
  )}\n`,
);
console.log("  wrote", trackPath);
