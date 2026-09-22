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

/*
 * /tiles/datasets — the per-dataset split of a clicked bucket's count.
 *
 * The invariant worth pinning is that it aggregates the SAME rows the tile did,
 * one grouping level finer. If its branches ever drift from the tile's, the
 * card will report numbers the hex it describes cannot account for.
 */

test("GET /tiles/datasets groups the tile's own rows by dataset", async () => {
  db.queueRaw([{ pk: 111, count: 1115 }]);
  const res = await agent
    .get("/tiles/datasets")
    .query({ z: 6, metric: "days", hexes: "970" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ pk: 111, count: 1115 }]);
  const sql = db.queries[0];
  assert.match(sql, /GROUP BY d\.pk_url/);
  // The bucket restriction is pushed into each branch (the scan prune), and
  // each table names its bucket differently.
  assert.match(sql, /hex_pk = ANY\(/);
  assert.match(sql, /"hex_1_pk" = ANY\(/);
  // The total is the tile's to report, not this route's: re-deriving it by
  // summing these parts would be wrong for `days`, where they overlap.
  assert.doesNotMatch(sql, /GROUPING SETS/);
});

test("GET /tiles/datasets at point zoom buckets on the point, not a hex", async () => {
  db.queueRaw([]);
  await agent
    .get("/tiles/datasets")
    .query({ z: 10, metric: "days", points: "42" });

  const sql = db.queries[0];
  assert.match(sql, /point_pk = ANY\(/);
  // Past z7 the cell tables are drawn by /tiles/cells instead, so the main
  // source is profiles alone — exactly as the tile route does it.
  assert.doesNotMatch(sql, /FROM cde\.trajectory_hexes/);
  assert.doesNotMatch(sql, /FROM cde\.obis_cells/);
});

test("GET /tiles/datasets source=cells asks the coverage layer's sources", async () => {
  db.queueRaw([]);
  await agent
    .get("/tiles/datasets")
    .query({ z: 10, metric: "days", hexes: "970", source: "cells" });

  const sql = db.queries[0];
  // /tiles/cells never reads profiles, and stays on hexes at any zoom.
  assert.doesNotMatch(sql, /FROM cde\.profiles/);
  assert.match(sql, /FROM cde\.trajectory_hexes/);
});

test("GET /tiles/datasets honours the layer switches the tile was drawn with", async () => {
  db.queueRaw([]);
  await agent.get("/tiles/datasets").query({
    z: 6,
    metric: "days",
    hexes: "970",
    includeTrajectory: "false",
  });

  assert.doesNotMatch(db.queries[0], /FROM cde\.trajectory_hexes/);
});

test("GET /tiles/datasets requires buckets and rejects junk in the pk lists", async () => {
  const noBuckets = await agent.get("/tiles/datasets").query({ z: 6 });
  assert.equal(noBuckets.status, 400);

  const junk = await agent
    .get("/tiles/datasets")
    .query({ z: 6, hexes: "970; DROP TABLE cde.datasets" });
  assert.equal(junk.status, 400);

  const noZoom = await agent.get("/tiles/datasets").query({ hexes: "970" });
  assert.equal(noZoom.status, 400);

  assert.equal(db.queries.length, 0);
});
