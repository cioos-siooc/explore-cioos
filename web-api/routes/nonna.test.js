const test = require("node:test");
const assert = require("node:assert/strict");

const axiosStub = require("../test/axiosStub");

const axios = axiosStub.install();

const { createTestApp } = require("../test/testApp");
const { agent } = createTestApp();

test.beforeEach(() => axios.reset());

// nonna.js keeps its own in-process L1 tile cache (a module-level Map, no
// reset hook) on top of redis (stubbed unavailable — see test/redisStub.js),
// so every test below uses distinct z/x/y coordinates: two tests sharing a
// key would have the second one served from the first's cache rather than
// reaching axios at all.

test("proxies a NONNA 10 tile from upstream and serves it as image/png", async () => {
  const png = Buffer.from("fake-png-bytes");
  axios.queueResponse({ data: png });

  const res = await agent.get("/nonna/10/6/10/10.png");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.ok(res.headers["cache-control"].includes("max-age=604800"));
  assert.ok(Buffer.from(res.body).equals(png));
  assert.equal(axios.calls[0].config.params.layer, "nonna:NONNA 10");
});

test("proxies a NONNA 100 tile with the right upstream layer name", async () => {
  axios.queueResponse({ data: Buffer.from("x") });
  await agent.get("/nonna/100/6/11/10.png");
  assert.equal(axios.calls[0].config.params.layer, "nonna:NONNA 100");
});

test("rejects an unknown layer without calling upstream", async () => {
  const res = await agent.get("/nonna/50/6/12/10.png");
  assert.equal(res.status, 400);
  assert.equal(axios.calls.length, 0);
});

test("serves a transparent placeholder, on a short TTL, when upstream fails", async () => {
  axios.queueError(new Error("connect ECONNREFUSED"));

  const res = await agent.get("/nonna/10/6/13/10.png");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.ok(res.headers["cache-control"].includes("max-age=60"));
});

test("rejects tile coordinates outside the grid at that zoom", async () => {
  // 2**6 = 64 columns/rows at zoom 6; 999 is out of range.
  const res = await agent.get("/nonna/10/6/999/10.png");
  assert.equal(res.status, 400);
  assert.equal(axios.calls.length, 0);
});

test("rejects a zoom past MAX_ZOOM", async () => {
  const res = await agent.get("/nonna/10/30/0/0.png");
  assert.equal(res.status, 400);
});

test("a second request for the SAME tile is served from the in-process cache, without a second upstream call", async () => {
  axios.queueResponse({ data: Buffer.from("cached-tile") });

  const first = await agent.get("/nonna/10/6/20/10.png");
  assert.equal(first.status, 200);
  assert.equal(axios.calls.length, 1);

  const second = await agent.get("/nonna/10/6/20/10.png");
  assert.equal(second.status, 200);
  assert.equal(axios.calls.length, 1); // no new upstream call
  assert.ok(Buffer.from(second.body).equals(Buffer.from("cached-tile")));
});
