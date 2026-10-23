const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const axiosStub = require("../test/axiosStub");
const { floatTiff } = require("../test/floatTiff");

const axios = axiosStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, resetCache } = createTestApp();

test.beforeEach(() => {
  axios.reset();
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

test("encodes NONNA 100 elevations as a Terrarium PNG, nodata transparent", async () => {
  axios.queueResponse(tileTiff({ 0: -12.5, 2: -4000.25, 3: 2 }));

  const res = await getTile("/nonna/6/10/10.png");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.ok(res.headers["cache-control"].includes("max-age=604800"));
  const elevationAt = await decodeTerrarium(res.body);
  assert.equal(elevationAt(0), -12.5);
  assert.equal(elevationAt(1), null);
  assert.equal(elevationAt(2), -4000.25);
  assert.equal(elevationAt(3), 2);

  assert.equal(axios.calls.length, 1);
  const url = new URL(axios.calls[0].url);
  assert.equal(url.searchParams.get("coverageId"), "nonna__NONNA 100 Coverage");
  assert.equal(url.searchParams.getAll("subset").length, 2);
  assert.equal(url.searchParams.get("scalesize"), "i(256),j(256)");
});

test("from zoom 11, NONNA 10 wins where it has soundings and NONNA 100 fills the rest", async () => {
  axios.queueResponse(tileTiff({ 0: -7 }));
  axios.queueResponse(tileTiff({ 0: -9, 200: -30 }));

  const res = await getTile("/nonna/11/600/700.png");

  const elevationAt = await decodeTerrarium(res.body);
  assert.equal(elevationAt(0), -7);
  assert.equal(elevationAt(200), -30);
  assert.equal(elevationAt(201), null);
  assert.deepEqual(
    axios.calls.map((c) => new URL(c.url).searchParams.get("coverageId")),
    ["nonna__NONNA 10 Coverage", "nonna__NONNA 100 Coverage"],
  );
});

test("NONNA 10's one-pixel seams fill from the soundings around them, in both tiles", async () => {
  // Pixel 1 is a seam between two 10 m soundings; pixel 200 is well clear of
  // any, so the hillshade leaves it and the colour takes NONNA 100's.
  axios.queueResponse(tileTiff({ 0: -6, 2: -8 }));
  axios.queueResponse(tileTiff({ 1: -30, 200: -40 }));

  const merged = await decodeTerrarium(
    (await getTile("/nonna/12/600/700.png")).body,
  );
  const fine = await decodeTerrarium(
    (await getTile("/nonna/10/12/600/700.png")).body,
  );

  assert.equal(merged(1), -7);
  assert.equal(fine(1), -7);
  assert.equal(merged(200), -40);
  assert.equal(fine(200), null);
  assert.equal(axios.calls.length, 2);
});

test("a merged tile from zoom 11 also caches the hillshade's, sparing its WCS calls", async () => {
  axios.queueResponse(tileTiff({ 0: -7 }));
  axios.queueResponse(tileTiff({ 0: -9, 1: -30 }));
  await getTile("/nonna/12/601/700.png");
  assert.equal(axios.calls.length, 2);

  const fine = await getTile("/nonna/10/12/601/700.png");

  assert.equal(axios.calls.length, 2);
  const elevationAt = await decodeTerrarium(fine.body);
  assert.equal(elevationAt(0), -7);
});

test("the hillshade's tile is transparent below NONNA 10's zoom", async () => {
  axios.queueResponse(tileTiff({ 0: -9 }));

  const res = await getTile("/nonna/10/8/70/90.png");

  assert.equal(res.headers["cache-control"], "public, max-age=60");
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
