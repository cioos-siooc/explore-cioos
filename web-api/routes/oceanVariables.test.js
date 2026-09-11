const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /oceanVariables returns the distinct, unnested EOV values", async () => {
  db.queueRaw([
    { ocean_variables: "oxygen" },
    { ocean_variables: "seaSurfaceTemperature" },
  ]);

  const res = await agent.get("/oceanVariables");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, ["oxygen", "seaSurfaceTemperature"]);
  assert.match(db.queries[0], /UNNEST\(eovs\)/);
});
