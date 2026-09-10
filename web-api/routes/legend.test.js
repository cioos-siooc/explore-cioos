const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("returns the recordsCount / coverageCount ramp domains", async () => {
  db.queueRaw([{ zoom0: [1, 100, 100], zoom1: [1, 50, 50], zoom2: [1, 10, 10] }]);
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
  const res = await agent.get("/legend").query({ profileTypes: "NotARealType" });
  assert.equal(res.status, 400);
});
