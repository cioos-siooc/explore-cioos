const test = require("node:test");
const assert = require("node:assert/strict");

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

const NODATA = 3.4028234663852886e38;
const nonna = (value) => ({ data: floatTiff([value], 1) });
// OPeNDAP's ASCII reply for one cell.
const gebco = (elevation) => ({
  data: [
    "Dataset { ... } GEBCO_2026.nc;",
    "---------------------------------------------",
    "elevation.elevation[1][1]",
    `[0], ${elevation}`,
    "",
    "elevation.lat[1]",
    "75.00208333333333",
    "",
  ].join("\n"),
});
const gebcoCell = (call) => new URL(call.url).search;

test("reads NONNA 10, as positive metres", async () => {
  axios.queueResponse(nonna(-26.43));

  const res = await agent.get("/depth?lon=-63.55&lat=44.62");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { depth: 26.4, resolution: 10, source: "nonna" });
  const subsets = new URL(axios.calls[0].url).searchParams.getAll("subset");
  assert.match(subsets[0], /^X\(-7074\d{3}\.\d+\)$/);
  assert.equal(
    new URL(axios.calls[0].url).searchParams.get("coverageId"),
    "nonna__NONNA 10 Coverage",
  );
  // GEBCO is only asked where CHS has nothing.
  assert.equal(axios.calls.length, 1);
});

test("ignores a NONNA sounding on land and asks GEBCO", async () => {
  water.setWater(false);
  axios.queueResponse(nonna(3.2));
  axios.queueResponse(gebco(12));

  const res = await agent.get("/depth?lon=-63.58&lat=44.65");

  assert.deepEqual(res.body, { depth: null, resolution: null, source: null });
  assert.deepEqual(water.calls, [{ lon: -63.58, lat: 44.65 }]);
});

test("keeps the NONNA sounding when the water mask fails", async () => {
  water.fail(new Error("timeout"));
  axios.queueResponse(nonna(-8));

  const res = await agent.get("/depth?lon=-63.5&lat=44.6");

  assert.deepEqual(res.body, { depth: 8, resolution: 10, source: "nonna" });
});

test("skips the water mask where CHS has no sounding", async () => {
  axios.queueResponse(nonna(NODATA));
  axios.queueResponse(gebco(-50));

  await agent.get("/depth?lon=-61&lat=43");

  assert.equal(water.calls.length, 0);
});

test("answers from GEBCO where CHS has no sounding", async () => {
  axios.queueResponse(nonna(NODATA));
  axios.queueResponse(gebco(-472));

  const res = await agent.get("/depth?lon=-60&lat=75");

  assert.deepEqual(res.body, { depth: 472, resolution: 463, source: "gebco" });
  assert.equal(gebcoCell(axios.calls[1]), "?elevation[39600][28800]");
});

test("reports no depth where GEBCO is at or above sea level", async () => {
  for (const elevation of [664, 0]) {
    axios.reset();
    resetCache();
    axios.queueResponse(nonna(NODATA));
    axios.queueResponse(gebco(elevation));

    const res = await agent.get("/depth?lon=-80&lat=77");

    assert.deepEqual(res.body, { depth: null, resolution: null, source: null });
  }
});

test("still answers from GEBCO when CHS fails", async () => {
  axios.queueError(new Error("timeout"));
  axios.queueResponse(gebco(-94));

  const res = await agent.get("/depth?lon=-63.4&lat=44.4");

  assert.deepEqual(res.body, { depth: 94, resolution: 463, source: "gebco" });
});

test("reads the last GEBCO column on the antimeridian", async () => {
  axios.queueResponse(nonna(NODATA));
  axios.queueResponse(gebco(-5000));

  await agent.get("/depth?lon=180&lat=0");

  assert.equal(gebcoCell(axios.calls[1]), "?elevation[21600][86399]");
});

test("answers null when GEBCO's reply has no value", async () => {
  axios.queueResponse(nonna(NODATA));
  axios.queueResponse({ data: "Error {\n  code = 500;\n};" });

  const res = await agent.get("/depth?lon=-61&lat=45");

  assert.deepEqual(res.body, { depth: null, resolution: null, source: null });
});

test("answers 502 when neither source does", async () => {
  axios.queueResponse(nonna(NODATA));
  axios.queueError(new Error("timeout"));

  const res = await agent.get("/depth?lon=-61&lat=45");

  assert.equal(res.status, 502);
});

test("rejects missing or out-of-range coordinates without calling upstream", async () => {
  assert.equal((await agent.get("/depth?lon=-63")).status, 400);
  assert.equal((await agent.get("/depth?lon=200&lat=44")).status, 400);
  assert.equal((await agent.get("/depth?lon=-63&lat=89")).status, 400);
  assert.equal(axios.calls.length, 0);
});
