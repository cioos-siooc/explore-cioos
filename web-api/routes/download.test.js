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

const EMAIL = { email: "diver@example.com" };

const VALID_QUERY = {
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

  const res = await agent.post("/download").query(VALID_QUERY).send(EMAIL);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 2 });
  assert.match(db.queries[1], /insert into "cde"\."download_jobs"/i);
});

test("nothing matched: returns count 0 and never inserts a job", async () => {
  shapeQuery.queueResult([]);
  db.queueRaw([{ json_agg: null }]);

  const res = await agent.post("/download").query(VALID_QUERY).send(EMAIL);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 0 });
  assert.equal(db.queries.length, 1); // only the SELECT, no insert
});

test("a taxon selection with OBIS disabled queues nothing at all, without a branch query", async () => {
  // createDBFilter still makes its own db.raw call to resolve the taxon to
  // aphia ids; only the route's own query never runs.
  shapeQuery.queueResult([]);
  db.queueRaw([{ aphia_id: 126436 }]);
  const res = await agent
    .post("/download")
    .query({
      ...VALID_QUERY,
      scientificNames: "Gadus morhua",
      includeObis: "false",
    })
    .send(EMAIL);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 0 });
  assert.equal(db.queries.length, 1); // only the aphia lookup, no branch query
});

test("requires a valid email", async () => {
  const res = await agent
    .post("/download")
    .query(VALID_QUERY)
    .send({ email: "not-an-email" });
  assert.equal(res.status, 400);
});

test("ignores an email in the query string — it belongs in the body", async () => {
  const res = await agent.post("/download").query({ ...VALID_QUERY, ...EMAIL });
  assert.equal(res.status, 400);
});

test("keeps the email out of the log line", async () => {
  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});
  const logged = [];
  const log = console.log;
  console.log = (...args) => logged.push(args.join(" "));
  try {
    await agent.post("/download").query(VALID_QUERY).send(EMAIL);
  } finally {
    console.log = log;
  }
  assert.ok(logged.length > 0);
  assert.ok(logged.every((line) => !line.includes(EMAIL.email)));
});

// shapeValidators() treats no shape at all as a valid, unbounded selection;
// it only rejects a half-specified bbox (see the next test).
test("with no shape at all, still accepted — queues against an unbounded selection", async () => {
  shapeQuery.queueResult([]);
  db.queueRaw([{ json_agg: null }]);
  const res = await agent.post("/download").send(EMAIL);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { count: 0 });
});

test("rejects a half-specified bounding box", async () => {
  const res = await agent
    .post("/download")
    .query({ latMin: "40", latMax: "50" })
    .send(EMAIL);
  assert.equal(res.status, 400);
});

test("is never cached — two identical requests both queue a job", async () => {
  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});
  const first = await agent.post("/download").query(VALID_QUERY).send(EMAIL);
  assert.equal(first.status, 200);

  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});
  const second = await agent.post("/download").query(VALID_QUERY).send(EMAIL);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { count: 1 });
});

test("rejects an unknown output format", async () => {
  const res = await agent
    .post("/download")
    .query({ ...VALID_QUERY, format: "xlsx" })
    .send(EMAIL);
  assert.equal(res.status, 400);
});

test("queues the chosen format and the filters as sent, without the email", async () => {
  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});

  await agent
    .post("/download")
    .query({ ...VALID_QUERY, format: "nccf", eovs: "seaSurfaceTemperature" })
    .send(EMAIL);

  const insert = db.queries[1];
  assert.match(insert, /"format":"nccf"/);
  assert.match(insert, /"filters":\{[^}]*"eovs":"seaSurfaceTemperature"/);
  assert.doesNotMatch(insert, /"filters":\{[^}]*diver@example\.com/);
});

test("links the package back to the selection in the Data Explorer", async () => {
  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});
  const polygon = "[[-65,44],[-62,44],[-63,45],[-65,44]]";

  await agent
    .post("/download")
    .query({
      eovs: "seaSurfaceTemperature",
      polygon,
      lang: "fr",
      format: "nccf",
    })
    .send(EMAIL);

  const url = new URL(db.queries[1].match(/"explorer_url":"([^"]+)"/)[1]);
  assert.equal(url.origin + url.pathname, "http://localhost:8098/");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    eovs: "seaSurfaceTemperature",
    polygon,
    lang: "fr",
  });
});

test("defaults to CSV and passes each dataset's matched feature IDs and metadata", async () => {
  shapeQuery.queueResult([{ pk_url: 1, size: 1000 }]);
  db.queueRaw([{ json_agg: [{ dataset_id: "obs_270" }] }]);
  db.queueRows({});

  await agent.post("/download").query(VALID_QUERY).send(EMAIL);

  assert.match(db.queries[0], /AS feature_ids/);
  assert.match(db.queries[0], /d\.metadata/);
  assert.match(db.queries[0], /d\.table_variables/);
  assert.match(db.queries[1], /"format":"csv"/);
});
