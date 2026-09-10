const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("returns the FeatureCollection built by the query", async () => {
  const fc = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { pk: 1 } }],
  };
  db.queueRaw([{ fc }]);

  const res = await agent.get("/griddapCoverage");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, fc);
});

test("short-circuits to an empty FeatureCollection for an OBIS-only selection, without querying", async () => {
  const res = await agent.get("/griddapCoverage").query({ obisNodes: "n1" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { type: "FeatureCollection", features: [] });
  assert.equal(db.queries.length, 0);
});

test("rejects an invalid metric", async () => {
  const res = await agent.get("/griddapCoverage").query({ metric: "bogus" });
  assert.equal(res.status, 400);
});
