const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /obisNodes returns the distinct OBIS node rows", async () => {
  db.queueRaw([{ name: "EurOBIS" }, { name: "OBIS-USA" }]);

  const res = await agent.get("/obisNodes");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ name: "EurOBIS" }, { name: "OBIS-USA" }]);
  assert.match(db.queries[0], /source_type = 'obis'/);
});
