const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("returns the matched min/max time bounds", async () => {
  db.queueRaw([{ min: "2010-01-01T00:00:00Z", max: "2024-01-01T00:00:00Z" }]);

  const res = await agent.get("/timeExtent");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    min: "2010-01-01T00:00:00Z",
    max: "2024-01-01T00:00:00Z",
  });
});

test("falls back to {min: null, max: null} for an empty result set", async () => {
  db.queueRaw([]);
  const res = await agent.get("/timeExtent");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { min: null, max: null });
});

test("rejects an unrecognized trajectoryTypes entry", async () => {
  const res = await agent
    .get("/timeExtent")
    .query({ trajectoryTypes: "NotAType" });
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("rejects includeObis outside true/false", async () => {
  const res = await agent.get("/timeExtent").query({ includeObis: "maybe" });
  assert.equal(res.status, 400);
});
