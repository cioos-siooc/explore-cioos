const test = require("node:test");
const assert = require("node:assert/strict");

const shapeQueryStub = require("../test/shapeQueryStub");

const shapeQuery = shapeQueryStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  shapeQuery.reset();
  resetCache();
});

const VALID_QUERY = {
  email: "diver@example.com",
  latMin: "40",
  latMax: "50",
  lonMin: "-70",
  lonMax: "-50",
};

test("queues a download job and returns the matched count", async () => {
  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([
    { json_agg: [{ dataset_id: "obs_270" }, { dataset_id: "obs_512" }] },
  ]);
  db.queueRows({}); // the .insert() into cde.download_jobs

  const res = await agent.get("/download").query(VALID_QUERY);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 2 });
  assert.match(db.queries[1], /insert into "cde"\."download_jobs"/i);
});

test("nothing matched: returns count 0 and never inserts a job", async () => {
  shapeQuery.queueResult([]);
  db.queueRaw([{ json_agg: null }]);

  const res = await agent.get("/download").query(VALID_QUERY);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 0 });
  assert.equal(db.queries.length, 1); // only the SELECT, no insert
});

test("a taxon selection with OBIS disabled queues nothing at all, without a branch query", async () => {
  // getShapeQuery runs unconditionally (it's what produces the size estimate
  // the job is stamped with), and so — earlier still — does createDBFilter,
  // which for a scientificNames selection resolves it to aphia ids via its
  // own single db.raw call (utils/dbFilter.js's fetchAphiaIdsFromDb). Only
  // the route's OWN branches array ends up empty, so only ITS db.raw never
  // runs.
  shapeQuery.queueResult([]);
  db.queueRaw([{ aphia_id: 126436 }]);
  const res = await agent.get("/download").query({
    ...VALID_QUERY,
    scientificNames: "Gadus morhua",
    includeObis: "false",
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 0 });
  assert.equal(db.queries.length, 1); // only the aphia lookup, no branch query
});

test("requires a valid email", async () => {
  const res = await agent
    .get("/download")
    .query({ ...VALID_QUERY, email: "not-an-email" });
  assert.equal(res.status, 400);
});

// The route's own comment claims "requires a shape (either polygon or
// latMin/Max)", but pipeline()'s shapeValidators() (utils/routePipeline.js)
// treats "neither a polygon nor any bbox param" as a VALID, unbounded
// selection — it only rejects a HALF-specified bbox (see the next test). So
// an emailed request naming no shape at all is accepted, not 400ed, and
// queues against whatever getShapeQuery resolves to.
test("with no shape at all, still accepted — queues against an unbounded selection", async () => {
  shapeQuery.queueResult([]);
  db.queueRaw([{ json_agg: null }]);
  const res = await agent
    .get("/download")
    .query({ email: "diver@example.com" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 0 });
});

test("rejects a half-specified bounding box", async () => {
  const res = await agent
    .get("/download")
    .query({ email: "diver@example.com", latMin: "40", latMax: "50" });
  assert.equal(res.status, 400);
});

test("is never cached — two identical requests both queue a job", async () => {
  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});
  const first = await agent.get("/download").query(VALID_QUERY);
  assert.equal(first.status, 200);

  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});
  const second = await agent.get("/download").query(VALID_QUERY);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { count: 1 });
});
