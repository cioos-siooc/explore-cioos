const test = require("node:test");
const assert = require("node:assert/strict");

const axiosStub = require("../test/axiosStub");
const { floatTiff } = require("../test/floatTiff");

const axios = axiosStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, resetCache } = createTestApp();

test.beforeEach(() => {
  axios.reset();
  resetCache();
});

const NODATA = 3.4028234663852886e38;
const nonna = (value) => ({ data: floatTiff([value], 1) });
const etopo = (z) => ({
  data: {
    table: { columnNames: ["latitude", "longitude", "z"], rows: [[0, 0, z]] },
  },
});

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
  // NOAA is only asked where CHS has nothing.
  assert.equal(axios.calls.length, 1);
});

test("answers from ETOPO where CHS has no sounding, land included", async () => {
  axios.queueResponse(nonna(NODATA));
  axios.queueResponse(etopo(9.71));

  const res = await agent.get("/depth?lon=-80&lat=75");

  assert.deepEqual(res.body, { depth: -9.7, resolution: 450, source: "etopo" });
  assert.equal(
    decodeURIComponent(new URL(axios.calls[1].url).search),
    "?z[(75)][(-80)]",
  );
});

test("still answers from ETOPO when CHS fails", async () => {
  axios.queueError(new Error("timeout"));
  axios.queueResponse(etopo(-94));

  const res = await agent.get("/depth?lon=-63.4&lat=44.4");

  assert.deepEqual(res.body, { depth: 94, resolution: 450, source: "etopo" });
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
