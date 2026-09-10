const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /platforms returns the distinct platform names", async () => {
  db.queueRaw([{ platform: "mooring" }, { platform: "surface vessel" }]);

  const res = await agent.get("/platforms");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, ["mooring", "surface vessel"]);
  assert.match(db.queries[0], /SELECT DISTINCT\s+platform FROM cde\.datasets/);
});

test("returns an empty array rather than throwing when there are none", async () => {
  db.queueRaw([]);
  const res = await agent.get("/platforms");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});
