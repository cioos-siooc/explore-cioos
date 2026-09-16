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

test("returns the LAST row of getShapeQuery's result (the requested dataset)", async () => {
  shapeQuery.queueResult([
    { pk_url: 1, title: "Other dataset" },
    { pk_url: 2, title: "The requested dataset" },
  ]);

  const res = await agent.get("/datasetRecordsList").query({ datasetPKs: "2" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { pk_url: 2, title: "The requested dataset" });
});

test("calls getShapeQuery for a records list, without an estimate", async () => {
  shapeQuery.queueResult([{ pk_url: 2 }]);
  await agent.get("/datasetRecordsList").query({ datasetPKs: "2" });
  assert.equal(shapeQuery.calls[0].doEstimate, false);
  assert.equal(shapeQuery.calls[0].getRecordsList, true);
});

test("requires datasetPKs to be an integer", async () => {
  const res = await agent
    .get("/datasetRecordsList")
    .query({ datasetPKs: "not-an-int" });
  assert.equal(res.status, 400);
  assert.equal(shapeQuery.calls.length, 0);
});

test("requires datasetPKs to be present at all", async () => {
  const res = await agent.get("/datasetRecordsList");
  assert.equal(res.status, 400);
});
