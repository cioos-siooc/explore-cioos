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

test("GET /harvest/freshness returns the stalest catalogue source's last good run", async () => {
  db.queueRaw([{ oldest_last_harvest: "2026-10-20T04:00:00Z" }]);

  const res = await agent.get("/harvest/freshness");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { oldestLastHarvest: "2026-10-20T04:00:00Z" });
  assert.match(db.queries[0], /MIN\(last_ok\)/);
  assert.match(db.queries[0], /r\.status = 'ok'/);
  assert.match(db.queries[0], /IN \(SELECT erddap_url FROM cde\.datasets\)/);
});

test("GET /harvest/freshness answers null before any harvest", async () => {
  db.queueRaw([]);

  const res = await agent.get("/harvest/freshness");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { oldestLastHarvest: null });
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
  // serverDatasets binds erddapUrl, erddapUrl, SPARKLINE_DEPTH, status, status, q, q, q, q, warning, warning
  assert.match(db.queries[1], /'error'/);
  assert.match(db.queries[1], /'obs_270'/);
});

test("GET /harvest/servers/:slug filters on a warning code via jsonb containment", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]);
  db.queueRaw([]);

  const res = await agent
    .get("/harvest/servers/erddap-example-com-erddap")
    .query({ warning: "FEATURES_DROPPED" });

  assert.equal(res.status, 200);
  assert.match(
    db.queries[1],
    /lw\.warnings @> jsonb_build_array\(jsonb_build_object\('code', CAST\('FEATURES_DROPPED' AS text\)\)\)/,
  );
});

test("GET /harvest/servers/:slug takes warnings from the latest success attempt", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]);
  db.queueRaw([]);

  await agent.get("/harvest/servers/erddap-example-com-erddap");

  assert.match(db.queries[1], /LEFT JOIN LATERAL/);
  assert.match(db.queries[1], /ok\.status = 'success'/);
  assert.match(db.queries[1], /lw\.warnings,/);
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
  db.queueRaw([{ warnings: [{ code: "FEATURES_HIDDEN", message: "m" }] }]); // latestSuccessWarnings

  const res = await agent.get(
    "/harvest/dataset/erddap-example-com-erddap/obs_270",
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.currentWarnings, [
    { code: "FEATURES_HIDDEN", message: "m" },
  ]);
  assert.match(db.queries[3], /ok\.status = 'success'/);
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
  db.queueRaw([]); // latestSuccessWarnings

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

test("GET /harvest/warnings/:slug returns the per-code breakdown for one server", async () => {
  db.queueRaw([{ erddap_url: "https://erddap.example.com/erddap" }]); // resolveErddapUrl
  const row = {
    code: "NON_CF_STANDARD_NAMES",
    n_datasets: 3,
    total_count: 7,
    dataset_ids: ["a", "b", "c"],
  };
  db.queueRaw([row]);

  const res = await agent.get("/harvest/warnings/erddap-example-com-erddap");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [row]);
  assert.match(
    db.queries[1],
    /erddap_url = 'https:\/\/erddap\.example\.com\/erddap'/,
  );
  assert.match(db.queries[1], /status = 'success'/);
  assert.match(db.queries[1], /jsonb_array_elements\(ls\.warnings\)/);
});
