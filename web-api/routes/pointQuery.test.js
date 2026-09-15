const test = require("node:test");
const assert = require("node:assert/strict");

const shapeQueryStub = require("../test/shapeQueryStub");

// shapeQuery.js has its own thorough SQL-building test suite
// (utils/shapeQuery.test.js) — this route is a thin passthrough, so its own
// tests are about wiring: what it hands getShapeQuery and what it does with
// the result, not shapeQuery's SQL.
const shapeQuery = shapeQueryStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, resetCache } = createTestApp();

test.beforeEach(() => {
  shapeQuery.reset();
  resetCache();
});

test("returns getShapeQuery's rows verbatim", async () => {
  const rows = [{ pk_url: 1, title: "A dataset", size: 12345 }];
  shapeQuery.queueResult(rows);

  const res = await agent.get("/pointQuery").query({ eovs: "oxygen" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, rows);
});

test("calls getShapeQuery without an estimate or a records list", async () => {
  shapeQuery.queueResult([]);
  await agent.get("/pointQuery");
  assert.equal(shapeQuery.calls.length, 1);
  assert.equal(shapeQuery.calls[0].doEstimate, false);
  assert.equal(shapeQuery.calls[0].getRecordsList, false);
});

// Unlike /download and /datasetRecordsList's shape counterparts, this route
// runs pipeline() with its shape:false default (see the route's own comment:
// "if no shape is given, it returns all datasets") — a half-specified bbox or
// a malformed polygon string is passed straight through to getShapeQuery
// rather than rejected here.
test("passes even a malformed polygon param straight through to getShapeQuery", async () => {
  shapeQuery.queueResult([]);
  const res = await agent.get("/pointQuery").query({ polygon: "not json" });
  assert.equal(res.status, 200);
  assert.equal(shapeQuery.calls[0].query.polygon, "not json");
});

test("rejects an out-of-range depth filter", async () => {
  const res = await agent.get("/pointQuery").query({ depthMin: "abc" });
  assert.equal(res.status, 400);
});
