const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

const FAKE_TILE = Buffer.from("fake-mvt-bytes");

test("GET /tiles/:z/:x/:y.mvt returns a binary MVT tile", async () => {
  db.queueRaw([{ st_asmvt: FAKE_TILE }]);

  const res = await agent.get("/tiles/6/20/20.mvt");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/x-protobuf");
  assert.equal(res.text, FAKE_TILE.toString());
});

test("GET /tiles/:z/:x/:y.mvt works at point zoom (z>=7) too", async () => {
  db.queueRaw([{ st_asmvt: FAKE_TILE }]);
  const res = await agent.get("/tiles/10/512/512.mvt");
  assert.equal(res.status, 200);
  assert.match(db.queries[0], /d\.platform as platform/);
});

test("GET /tiles/:z/:x/:y.mvt rejects an unknown metric", async () => {
  const res = await agent.get("/tiles/6/20/20.mvt").query({ metric: "bogus" });
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("GET /tiles/:z/:x/:y.mvt rejects tile coordinates outside the grid at that zoom", async () => {
  // 2**6 = 64 columns/rows at zoom 6; 999 is out of range.
  const res = await agent.get("/tiles/6/999/20.mvt");
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("GET /tiles/:z/:x/:y.mvt rejects a negative zoom", async () => {
  const res = await agent.get("/tiles/-1/0/0.mvt");
  assert.equal(res.status, 400);
});

test("GET /tiles/:z/:x/:y.mvt an OBIS-only selection drops the profiles/trajectory branches", async () => {
  db.queueRaw([{ st_asmvt: FAKE_TILE }]);
  const res = await agent.get("/tiles/6/20/20.mvt").query({ obisNodes: "n1" });
  assert.equal(res.status, 200);
  const sql = db.queries[0];
  assert.doesNotMatch(sql, /FROM cde\.profiles/);
  assert.doesNotMatch(sql, /FROM cde\.trajectory_hexes/);
});

test("GET /tiles/cells/:z/:x/:y.mvt returns a binary MVT tile", async () => {
  db.queueRaw([{ st_asmvt: FAKE_TILE }]);

  const res = await agent.get("/tiles/cells/6/20/20.mvt");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/x-protobuf");
  assert.equal(res.text, FAKE_TILE.toString());
  assert.match(db.queries[0], /trajectory_count/);
  assert.match(db.queries[0], /obis_count/);
});

test("GET /tiles/cells/:z/:x/:y.mvt still aggregates as hexes past the point-tier zoom", async () => {
  db.queueRaw([{ st_asmvt: FAKE_TILE }]);
  const res = await agent.get("/tiles/cells/10/512/512.mvt");
  assert.equal(res.status, 200);
  assert.match(db.queries[0], /coverage-hexes-layer/);
});

test("GET /tiles/cells/:z/:x/:y.mvt rejects out-of-grid tile coordinates", async () => {
  const res = await agent.get("/tiles/cells/6/999/20.mvt");
  assert.equal(res.status, 400);
});

test("GET /tiles/tracks/:z/:x/:y.mvt requires timeMin and timeMax", async () => {
  const res = await agent.get("/tiles/tracks/6/20/20.mvt");
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("GET /tiles/tracks/:z/:x/:y.mvt requires timeMax even when timeMin is given", async () => {
  const res = await agent
    .get("/tiles/tracks/6/20/20.mvt")
    .query({ timeMin: "2020-01-01T00:00:00Z" });
  assert.equal(res.status, 400);
});

test("GET /tiles/tracks/:z/:x/:y.mvt 204s when includeTrajectory=false, without querying", async () => {
  const res = await agent.get("/tiles/tracks/6/20/20.mvt").query({
    timeMin: "2020-01-01T00:00:00Z",
    timeMax: "2020-02-01T00:00:00Z",
    includeTrajectory: "false",
  });
  assert.equal(res.status, 204);
  assert.equal(db.queries.length, 0);
});

test("GET /tiles/tracks/:z/:x/:y.mvt 204s for an OBIS-only selection, without querying", async () => {
  const res = await agent.get("/tiles/tracks/6/20/20.mvt").query({
    timeMin: "2020-01-01T00:00:00Z",
    timeMax: "2020-02-01T00:00:00Z",
    obisNodes: "n1",
  });
  assert.equal(res.status, 204);
  assert.equal(db.queries.length, 0);
});

test("GET /tiles/tracks/:z/:x/:y.mvt returns a binary MVT tile with both track layers", async () => {
  db.queueRaw([{ st_asmvt: FAKE_TILE }]);

  const res = await agent.get("/tiles/tracks/6/20/20.mvt").query({
    timeMin: "2020-01-01T00:00:00Z",
    timeMax: "2020-02-01T00:00:00Z",
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/x-protobuf");
  assert.equal(res.text, FAKE_TILE.toString());
  assert.match(db.queries[0], /track-lines/);
  assert.match(db.queries[0], /track-heads/);
});

test("GET /tiles/tracks/:z/:x/:y.mvt rejects an unrecognized trajectoryTypes entry", async () => {
  const res = await agent.get("/tiles/tracks/6/20/20.mvt").query({
    timeMin: "2020-01-01T00:00:00Z",
    timeMax: "2020-02-01T00:00:00Z",
    trajectoryTypes: "NotAType",
  });
  assert.equal(res.status, 400);
});

test("GET /tiles/tracks/:z/:x/:y.mvt caps the candidate set at TRACKS_MAX_PER_TILE", async () => {
  db.queueRaw([{ st_asmvt: FAKE_TILE }]);
  await agent.get("/tiles/tracks/6/20/20.mvt").query({
    timeMin: "2020-01-01T00:00:00Z",
    timeMax: "2020-02-01T00:00:00Z",
  });
  assert.match(db.queries[0], /LIMIT 2500/);
});
