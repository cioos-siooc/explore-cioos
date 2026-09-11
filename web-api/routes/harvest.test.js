const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /harvest/servers returns the per-server summary rows", async () => {
  db.queueRaw([
    {
      erddap_url: "https://erddap.example.com/erddap",
      source: "erddap",
      last_attempted_at: "2024-03-01T00:00:00Z",
      n_success: 40,
      n_skipped: 2,
      n_error: 1,
    },
  ]);

  const res = await agent.get("/harvest/servers");

  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].erddap_url, "https://erddap.example.com/erddap");
});

test("GET /harvest/servers/:slug resolves the slug and returns its datasets", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]); // resolveErddapUrl lookup
  db.queueRaw([{ dataset_id: "obs_270", status: "success" }]);

  const res = await agent.get("/harvest/servers/erddap-example-com-erddap");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ dataset_id: "obs_270", status: "success" }]);
});

test("GET /harvest/servers/:slug passes status/q through to the query", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]);
  db.queueRaw([]);

  const res = await agent
    .get("/harvest/servers/erddap-example-com-erddap")
    .query({ status: "error", q: "obs_270" });

  assert.equal(res.status, 200);
  // serverDatasets binds erddapUrl, erddapUrl, SPARKLINE_DEPTH, status, status, q, q, q, q
  assert.match(db.queries[1], /'error'/);
  assert.match(db.queries[1], /'obs_270'/);
});

test("GET /harvest/dataset/:slug/:datasetId 404s when the dataset has no harvest history", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]); // resolveErddapUrl
  db.queueRaw([]); // datasetHistory: empty

  const res = await agent.get(
    "/harvest/dataset/erddap-example-com-erddap/obs_270",
  );

  assert.equal(res.status, 404);
});

test("GET /harvest/dataset/:slug/:datasetId returns history + meta when found", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]); // resolveErddapUrl
  db.queueRaw([{ run_id: "r1", status: "success" }]); // datasetHistory
  db.queueRaw([{ content_hash: "abc123" }]); // datasetMeta

  const res = await agent.get(
    "/harvest/dataset/erddap-example-com-erddap/obs_270",
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.history.length, 1);
  assert.equal(res.body.meta.content_hash, "abc123");
  assert.equal(res.body.erddap_url, "https://erddap.example.com/erddap");
});

test("GET /harvest/runs/recent returns the recent-runs summary", async () => {
  db.queueRaw([{ run_id: "r1", status: "success", n_success: 10 }]);
  const res = await agent.get("/harvest/runs/recent");
  assert.equal(res.status, 200);
  assert.equal(res.body[0].run_id, "r1");
});

test("GET /harvest/runs/:runId 404s when the run doesn't exist", async () => {
  db.queueRaw([]); // runDetail: no row
  const res = await agent.get(
    "/harvest/runs/11111111-1111-1111-1111-111111111111",
  );
  assert.equal(res.status, 404);
});

test("GET /harvest/runs/:runId returns the run and its attempts when found", async () => {
  db.queueRaw([{ run_id: "r1", status: "success" }]); // runDetail
  db.queueRaw([{ dataset_id: "obs_270", status: "success" }]); // runAttempts

  const res = await agent.get(
    "/harvest/runs/11111111-1111-1111-1111-111111111111",
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.run.run_id, "r1");
  assert.equal(res.body.attempts.length, 1);
});

// /runs/recent must resolve before /runs/:runId, or "recent" gets swallowed
// as a runId — pin the route order this way rather than only by inspection.
test("GET /harvest/runs/recent is not captured by /runs/:runId", async () => {
  db.queueRaw([]);
  const res = await agent.get("/harvest/runs/recent");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("GET /harvest/reasons returns the catalogue-wide failure breakdown", async () => {
  db.queueRaw([{ reason_code: "HTTP_ERROR", n: 4 }]);
  const res = await agent.get("/harvest/reasons");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ reason_code: "HTTP_ERROR", n: 4 }]);
});

test("GET /harvest/reasons/:slug scopes the breakdown to one server", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]); // resolveErddapUrl
  db.queueRaw([{ reason_code: "HTTP_ERROR", n: 2 }]);

  const res = await agent.get("/harvest/reasons/erddap-example-com-erddap");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ reason_code: "HTTP_ERROR", n: 2 }]);
});
