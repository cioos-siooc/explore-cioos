const test = require("node:test");
const assert = require("node:assert/strict");

const shapeQueryStub = require("../test/shapeQueryStub");

const shapeQuery = shapeQueryStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  shapeQuery.reset();
  db.reset();
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

test("GET /datasetRecordsList/location returns the record's coordinates", async () => {
  db.queueRaw([{ longitude: -63.1, latitude: 44.6 }]);

  const res = await agent
    .get("/datasetRecordsList/location")
    .query({ datasetPKs: "42", recordId: "station 7" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { coordinates: [[-63.1, 44.6]] });
  assert.match(db.queries[0], /pk_url = 42/);
  assert.match(db.queries[0], /= 'station 7'/);
});

test("GET /datasetRecordsList/location requires an integer datasetPKs and a recordId", async () => {
  for (const query of [
    { datasetPKs: "not-an-int", recordId: "a" },
    { datasetPKs: "42" },
  ]) {
    const res = await agent.get("/datasetRecordsList/location").query(query);
    assert.equal(res.status, 400);
  }
  assert.equal(db.queries.length, 0);
});
