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

test("GET /harvest/servers/:slug selects dataset_is_realtime for each dataset", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]); // resolveErddapUrl
  db.queueRaw([
    { dataset_id: "obs_270", status: "success", is_realtime: true },
  ]);

  const res = await agent.get("/harvest/servers/erddap-example-com-erddap");

  assert.equal(res.status, 200);
  assert.equal(res.body[0].is_realtime, true);
  assert.match(
    db.queries[1],
    /dataset_is_realtime\(ds\.coverage_time_max, ds\.verified_at,\s*ds\.cdm_data_type\)/,
  );
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
  db.queueRaw([{ content_hash: "abc123", is_realtime: true }]); // datasetMeta

  const res = await agent.get(
    "/harvest/dataset/erddap-example-com-erddap/obs_270",
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.history.length, 1);
  assert.equal(res.body.meta.content_hash, "abc123");
  assert.equal(res.body.meta.is_realtime, true);
  assert.equal(res.body.erddap_url, "https://erddap.example.com/erddap");
  assert.equal(res.body.historyTruncated, false);
  assert.equal(res.body.historyLimit, 200);
});

test("GET /harvest/dataset/:slug/:datasetId flags historyTruncated once the row cap is hit", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]); // resolveErddapUrl
  // datasetHistory asks for HISTORY_MAX_ROWS(200) + 1 to detect truncation —
  // queue 201 rows so the route sees more than the cap.
  db.queueRaw(
    Array.from({ length: 201 }, (_, i) => ({
      run_id: `r${i}`,
      status: "success",
    })),
  );
  db.queueRaw([{ content_hash: "abc123" }]); // datasetMeta

  const res = await agent.get(
    "/harvest/dataset/erddap-example-com-erddap/obs_270",
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.history.length, 200);
  assert.equal(res.body.historyTruncated, true);
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

test("GET /harvest/coverage returns the summary and the per-source rows", async () => {
  db.queueRaw([
    {
      n_app_total: 120,
      n_app_erddap: 100,
      n_app_obis: 20,
      n_ckan_records: 300,
      n_erddap_not_in_app: 7,
      n_erddap_without_ckan: 3,
      ckan_snapshot_at: "2026-09-15T00:00:00Z",
    },
  ]);
  db.queueRaw([
    {
      erddap_url: "https://erddap.example.com/erddap",
      source: "erddap",
      n_advertised: 107,
      n_not_in_app: 7,
      n_without_ckan: 3,
    },
  ]);

  const res = await agent.get("/harvest/coverage");

  assert.equal(res.status, 200);
  assert.equal(res.body.summary.n_app_total, 120);
  assert.equal(res.body.summary.n_erddap_not_in_app, 7);
  assert.equal(res.body.sources.length, 1);
  assert.equal(res.body.sources[0].n_not_in_app, 7);
});

test("GET /harvest/coverage/:bucket returns one page and the total", async () => {
  db.queueRaw([{ n: 3533 }]);
  db.queueRaw([
    {
      erddap_url: "https://erddap.example.com/erddap",
      dataset_id: "orphan_ds",
      status: "error",
      reason_code: "HTTP_ERROR",
    },
  ]);

  const res = await agent.get("/harvest/coverage/erddap-not-in-app");

  assert.equal(res.status, 200);
  assert.equal(res.body.rows[0].dataset_id, "orphan_ds");
  // The total comes from a COUNT over the same set, so the page can say how
  // far the list runs rather than only whether it was cut off.
  assert.equal(res.body.total, 3533);
  assert.equal(res.body.offset, 0);
});

test("GET /harvest/coverage/:bucket offsets by page", async () => {
  db.queueRaw([{ n: 3533 }]);
  db.queueRaw([]);

  const res = await agent
    .get("/harvest/coverage/erddap-not-in-app")
    .query({ page: 3 });

  assert.equal(res.status, 200);
  assert.equal(res.body.offset, 100);
  // The count must not carry the page's LIMIT, or it would report the page
  // size back as the total and the pager would stop after one step.
  assert.doesNotMatch(db.queries[0], /LIMIT/);
  assert.match(db.queries[1], /LIMIT 50 OFFSET 100/);
});

test("GET /harvest/coverage/:bucket clamps a page past the end of the list", async () => {
  // A stale bookmark on a bucket that has since shrunk. An empty slice would
  // render as "nothing in this category", which is a different claim.
  db.queueRaw([{ n: 120 }]);
  db.queueRaw([]);

  const res = await agent
    .get("/harvest/coverage/erddap-not-in-app")
    .query({ page: 90 });

  assert.equal(res.status, 200);
  assert.equal(res.body.offset, 100);
  assert.match(db.queries[1], /OFFSET 100/);
});

test("GET /harvest/coverage/:bucket lands a junk page number on page one", async () => {
  // The page number arrives from a URL a person can edit; a negative offset is
  // a Postgres error, not an empty list.
  db.queueRaw([{ n: 0 }]);
  db.queueRaw([]);

  const res = await agent
    .get("/harvest/coverage/erddap-not-in-app")
    .query({ page: "-4" });

  assert.equal(res.status, 200);
  assert.equal(res.body.offset, 0);
});

test("GET /harvest/coverage/:bucket?format=csv exports without counting", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]);

  const res = await agent
    .get("/harvest/coverage/erddap-not-in-app")
    .query({ format: "csv" });

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/csv/);
  // One query only: the export takes every row, so there is nothing a total
  // would tell it. Queuing a single result is what pins that.
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0], /LIMIT 20000 OFFSET 0/);
});

test("GET /harvest/coverage/:bucket 404s an unknown bucket", async () => {
  // Nothing is queued: an unknown bucket must be rejected before any db call.
  const res = await agent.get("/harvest/coverage/made-up");

  assert.equal(res.status, 404);
});
