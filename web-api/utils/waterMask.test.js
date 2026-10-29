const test = require("node:test");
const assert = require("node:assert/strict");
const { default: GeoJSONVT } = require("geojson-vt");
const vtpbf = require("vt-pbf");

const axiosStub = require("../test/axiosStub");

const axios = axiosStub.install();

const { isWaterAt, waterMask } = require("./waterMask");

test.beforeEach(() => axios.reset());

const TILEJSON = {
  data: { tiles: ["https://ofm.test/planet/v1/{z}/{x}/{y}.pbf"] },
};

// The world tile, with `layerName` holding the western hemisphere.
function westernHalfTile(layerName) {
  const west = {
    type: "Feature",
    properties: { class: "ocean" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-180, -85],
          [0, -85],
          [0, 85],
          [-180, 85],
          [-180, -85],
        ],
      ],
    },
  };
  const tile = new GeoJSONVT(
    { type: "FeatureCollection", features: [west] },
    { maxZoom: 0, buffer: 0 },
  ).getTile(0, 0, 0);
  return { data: vtpbf.fromGeojsonVt({ [layerName]: tile }) };
}

// Runs first: the TileJSON is fetched once per process.
test("marks the pixels under the water polygons", async () => {
  axios.queueResponse(TILEJSON);
  axios.queueResponse(westernHalfTile("water"));

  const mask = await waterMask(0, 0, 0);

  assert.equal(mask.length, 256 * 256);
  assert.equal(mask[128 * 256 + 10], 1);
  assert.equal(mask[128 * 256 + 245], 0);
  assert.equal(axios.calls[1].url, "https://ofm.test/planet/v1/0/0/0.pbf");
});

test("reuses the TileJSON's tile URL", async () => {
  axios.queueResponse(westernHalfTile("water"));
  await waterMask(0, 0, 0);
  assert.equal(axios.calls.length, 1);
});

test("a tile without a water layer is all land", async () => {
  axios.queueResponse(westernHalfTile("landcover"));
  const mask = await waterMask(0, 0, 0);
  assert.ok(mask.every((v) => v === 0));
});

test("looks a point up in its z14 tile", async () => {
  axios.queueResponse(westernHalfTile("water"));
  // Tile 14/8191/8191 sits just west of 0,0; its west quarter is water.
  assert.equal(await isWaterAt(-0.02, 0.01), true);
  assert.equal(
    axios.calls[0].url,
    "https://ofm.test/planet/v1/14/8191/8191.pbf",
  );
});
