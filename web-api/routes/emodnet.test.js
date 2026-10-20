const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const axiosStub = require("../test/axiosStub");

const axios = axiosStub.install();

const { createTestApp } = require("../test/testApp");
const { agent } = createTestApp();

test.beforeEach(() => axios.reset());

// emodnet.js keeps an in-process L1 tile cache with no reset hook, so every
// test uses distinct z/x/y coordinates.

const opaquePng = () =>
  sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 82, g: 167, b: 155, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

test("fetches the EMODnet PNG and serves it re-encoded as opaque WebP", async () => {
  axios.queueResponse({ data: await opaquePng() });

  const res = await agent
    .get("/emodnet/6/16/20.webp")
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/webp");
  assert.ok(res.headers["cache-control"].includes("max-age=2592000"));
  assert.equal(
    axios.calls[0].url,
    "https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/6/16/20.png",
  );
  const meta = await sharp(res.body).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.hasAlpha, false);
});

test("a second request for the same tile is served from cache", async () => {
  axios.queueResponse({ data: await opaquePng() });

  await agent.get("/emodnet/6/17/20.webp");
  const second = await agent.get("/emodnet/6/17/20.webp");

  assert.equal(second.status, 200);
  assert.equal(second.headers["content-type"], "image/webp");
  assert.equal(axios.calls.length, 1);
});

test("serves a transparent placeholder, on a short TTL, when upstream fails", async () => {
  axios.queueError(new Error("connect ECONNREFUSED"));

  const res = await agent.get("/emodnet/6/18/20.webp");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.ok(res.headers["cache-control"].includes("max-age=60"));
});

test("does not cache a failed tile", async () => {
  axios.queueError(new Error("timeout"));
  await agent.get("/emodnet/6/19/20.webp");
  axios.queueResponse({ data: await opaquePng() });

  const res = await agent.get("/emodnet/6/19/20.webp");

  assert.equal(res.headers["content-type"], "image/webp");
  assert.equal(axios.calls.length, 2);
});

test("rejects a zoom deeper than the basemap requests", async () => {
  const res = await agent.get("/emodnet/10/0/0.webp");
  assert.equal(res.status, 400);
  assert.equal(axios.calls.length, 0);
});

test("rejects tile coordinates outside the grid at that zoom", async () => {
  const res = await agent.get("/emodnet/6/999/10.webp");
  assert.equal(res.status, 400);
  assert.equal(axios.calls.length, 0);
});
