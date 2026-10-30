const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const axiosStub = require("../test/axiosStub");
const waterMaskStub = require("../test/waterMaskStub");
const { floatTiff } = require("../test/floatTiff");

const axios = axiosStub.install();
const water = waterMaskStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, resetCache } = createTestApp();

test.beforeEach(() => {
  axios.reset();
  water.reset();
  resetCache();
});

// nonna.js keeps its own in-process L1 tile cache (a module-level Map, no
// reset hook) on top of redis (stubbed unavailable — see test/redisStub.js),
// so every tile test below uses distinct z/x/y coordinates: two tests sharing
// a key would have the second one served from the first's cache rather than
// reaching axios at all.

const NODATA = 3.4028234663852886e38;
const TILE_PIXELS = 256 * 256;

function tileTiff(pixels) {
  const values = new Array(TILE_PIXELS).fill(NODATA);
  Object.entries(pixels).forEach(([i, v]) => {
    values[i] = v;
  });
  return { data: floatTiff(values, 256) };
}

const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

async function decodeTerrarium(png) {
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return (i) =>
    data[i * 4 + 3] === 0
      ? null
      : data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
}

const getTile = (path) => agent.get(path).buffer(true).parse(binary);

test("encodes NONNA 10 elevations as a Terrarium PNG, nodata transparent", async () => {
  axios.queueResponse(tileTiff({ 0: -12.5, 2: -4000.25, 3: 2 }));

  const res = await getTile("/nonna/6/10/10.png");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.ok(res.headers["cache-control"].includes("max-age=604800"));
  const elevationAt = await decodeTerrarium(res.body);
  assert.equal(elevationAt(0), -12.5);
  assert.equal(elevationAt(2), -4000.25);
  assert.equal(elevationAt(3), 2);
  assert.equal(elevationAt(100), null);

  assert.equal(axios.calls.length, 1);
  const url = new URL(axios.calls[0].url);
  assert.equal(url.searchParams.get("coverageId"), "nonna__NONNA 10 Coverage");
  assert.equal(url.searchParams.getAll("subset").length, 2);
  assert.equal(url.searchParams.get("scalesize"), "i(256),j(256)");
});

test("NONNA 10's one-pixel seams fill from the soundings around them", async () => {
  // Pixel 1 is a seam between two soundings; pixel 300 is well clear of any.
  axios.queueResponse(tileTiff({ 0: -6, 2: -8 }));

  const elevationAt = await decodeTerrarium(
    (await getTile("/nonna/12/600/700.png")).body,
  );

  assert.equal(elevationAt(1), -7);
  assert.equal(elevationAt(300), null);
});

test("clears soundings outside OSM water, after the seam fill", async () => {
  // Pixel 1 would be seam-filled from 0 and 2; 0 and 1 are land.
  const mask = new Uint8Array(TILE_PIXELS).fill(1);
  mask[0] = 0;
  mask[1] = 0;
  water.setMask(mask);
  axios.queueResponse(tileTiff({ 0: 3, 2: -8 }));

  const elevationAt = await decodeTerrarium(
    (await getTile("/nonna/12/601/700.png")).body,
  );

  assert.equal(elevationAt(0), null);
  assert.equal(elevationAt(1), null);
  assert.equal(elevationAt(2), -8);
  assert.deepEqual(water.calls, [{ z: 12, x: 601, y: 700 }]);
});

test("skips the water mask for a tile without soundings", async () => {
  axios.queueResponse(tileTiff({}));
  await getTile("/nonna/12/602/700.png");
  assert.equal(water.calls.length, 0);
});

test("serves the placeholder, uncached, when the water mask fails", async () => {
  water.fail(new Error("OFM down"));
  axios.queueResponse(tileTiff({ 0: -5 }));

  const res = await getTile("/nonna/12/603/700.png");

  assert.ok(res.headers["cache-control"].includes("max-age=60"));

  water.reset();
  axios.queueResponse(tileTiff({ 0: -5 }));
  const retry = await getTile("/nonna/12/603/700.png");
  assert.equal((await decodeTerrarium(retry.body))(0), -5);
});

test("requests the tile's Web Mercator bounds", async () => {
  axios.queueResponse(tileTiff({}));
  await getTile("/nonna/1/1/0.png");
  const subsets = new URL(axios.calls[0].url).searchParams.getAll("subset");
  assert.deepEqual(subsets, [
    "X(0,20037508.342789244)",
    "Y(0,20037508.342789244)",
  ]);
});

test("serves a transparent placeholder, on a short TTL, when upstream fails", async () => {
  axios.queueError(new Error("connect ECONNREFUSED"));

  const res = await getTile("/nonna/6/13/10.png");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.ok(res.headers["cache-control"].includes("max-age=60"));
  const { data, info } = await sharp(res.body)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [256, 256, 4]);
  assert.ok(data.every((byte) => byte === 0));
});

test("rejects tile coordinates outside the grid at that zoom", async () => {
  // 2**6 = 64 columns/rows at zoom 6; 999 is out of range.
  const res = await agent.get("/nonna/6/999/10.png");
  assert.equal(res.status, 400);
  assert.equal(axios.calls.length, 0);
});

test("rejects a zoom past MAX_ZOOM", async () => {
  const res = await agent.get("/nonna/30/0/0.png");
  assert.equal(res.status, 400);
});

test("a second request for the SAME tile is served from the in-process cache, without a second upstream call", async () => {
  axios.queueResponse(tileTiff({ 0: -1 }));

  const first = await getTile("/nonna/6/20/10.png");
  assert.equal(first.status, 200);
  assert.equal(axios.calls.length, 1);

  const second = await getTile("/nonna/6/20/10.png");
  assert.equal(second.status, 200);
  assert.equal(axios.calls.length, 1); // no new upstream call
  assert.ok(second.body.equals(first.body));
});
