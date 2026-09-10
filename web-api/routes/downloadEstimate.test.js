const test = require("node:test");
const assert = require("node:assert/strict");

const shapeQueryStub = require("../test/shapeQueryStub");

const shapeQuery = shapeQueryStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, resetCache } = createTestApp();

test.beforeEach(() => {
  shapeQuery.reset();
  resetCache();
});

test("reshapes getShapeQuery's rows to {pk, dataset_id, size}", async () => {
  shapeQuery.queueResult([
    { pk_url: 1, dataset_id: "obs_270", size: 184320, title: "dropped" },
  ]);

  const res = await agent
    .get("/downloadEstimate")
    .query({ datasetPKs: "1" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ pk: 1, dataset_id: "obs_270", size: 184320 }]);
});

test("calls getShapeQuery with the estimate flag, no records list", async () => {
  shapeQuery.queueResult([]);
  await agent.get("/downloadEstimate").query({ datasetPKs: "1" });
  assert.equal(shapeQuery.calls[0].doEstimate, true);
  assert.equal(shapeQuery.calls[0].getRecordsList, false);
});

test("an empty result set reshapes to an empty array", async () => {
  shapeQuery.queueResult([]);
  const res = await agent.get("/downloadEstimate").query({ datasetPKs: "1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});
