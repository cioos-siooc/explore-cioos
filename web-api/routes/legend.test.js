const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("returns the recordsCount / coverageCount ramp domains", async () => {
  db.queueRaw([
    { zoom0: [1, 100, 100], zoom1: [1, 50, 50], zoom2: [1, 10, 10] },
  ]);
  db.queueRaw([{ zoom1: [1, 20, 20] }]);

  const res = await agent.get("/legend");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.recordsCount, {
    zoom0: [1, 100, 100],
    zoom1: [1, 50, 50],
    zoom2: [1, 10, 10],
  });
  assert.deepEqual(res.body.coverageCount, { zoom1: [1, 20, 20] });
});

test("rejects an unknown metric", async () => {
  const res = await agent.get("/legend").query({ metric: "bogus" });
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("rejects an out-of-range depth filter", async () => {
  const res = await agent.get("/legend").query({ depthMin: "abc" });
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("rejects an unrecognized profileTypes entry", async () => {
  const res = await agent
    .get("/legend")
    .query({ profileTypes: "NotARealType" });
  assert.equal(res.status, 400);
});

const ROLLUP = /FROM cde\.hexes_zoom_0_rollup/;

test("a dataset-level selection takes only the zoom0 ramp from the rollup", async () => {
  db.queueRaw([{}]);
  db.queueRaw([{}]);
  await agent.get("/legend").query({ metric: "days", obisNodes: "n1" });
  const [main, coverage] = db.queries;
  assert.match(main, ROLLUP);
  assert.match(main, /FROM rollup_records WHERE hex_0_pk IS NOT NULL/);
  assert.match(main, /FROM hex_records WHERE hex_1_pk IS NOT NULL/);
  // obisNodes alone is OBIS-only: the rollup must not pull ERDDAP sources.
  assert.match(main, /source = 'obis'/);
  assert.doesNotMatch(main, /source = '(profiles|trajectory)'/);
  assert.doesNotMatch(coverage, ROLLUP);
});

test("a feature-level filter keeps the zoom0 ramp on the feature tables", async () => {
  db.queueRaw([{}]);
  db.queueRaw([{}]);
  await agent.get("/legend").query({ timeMin: "2020-01-01T00:00:00Z" });
  assert.doesNotMatch(db.queries[0], ROLLUP);
  assert.match(db.queries[0], /FROM hex_records WHERE hex_0_pk IS NOT NULL/);
});
