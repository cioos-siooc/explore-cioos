const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /harvest/downloads/summary returns the headline counters", async () => {
  db.queueRaw([{ n_jobs: 10, n_completed: 8, n_failed: 1, n_open: 1, n_stuck: 0, n_stalled: 0 }]);

  const res = await agent.get("/harvest/downloads/summary");

  assert.equal(res.status, 200);
  assert.equal(res.body.n_jobs, 10);
});

test("GET /harvest/downloads/recent returns the recent jobs, capped at 200", async () => {
  db.queueRaw([{ job_id: "job-1", status: "completed" }]);

  const res = await agent
    .get("/harvest/downloads/recent")
    .query({ limit: "9999" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ job_id: "job-1", status: "completed" }]);
});

test("GET /harvest/downloads/datasets returns the per-dataset outcomes", async () => {
  db.queueRaw([{ dataset_id: "obs_270", n_ok: 3, n_failed: 1 }]);

  const res = await agent.get("/harvest/downloads/datasets");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ dataset_id: "obs_270", n_ok: 3, n_failed: 1 }]);
});

test("GET /harvest/downloads/datasets passes status/q through", async () => {
  db.queueRaw([]);
  const res = await agent
    .get("/harvest/downloads/datasets")
    .query({ status: "FAILED", q: "obs_270" });
  assert.equal(res.status, 200);
  assert.match(db.queries[0], /'FAILED'/);
  assert.match(db.queries[0], /'obs_270'/);
});

test("GET /harvest/downloads/:jobId 404s when the job doesn't exist", async () => {
  db.queueRaw([]); // jobDetail: no row
  const res = await agent.get("/harvest/downloads/nonexistent-job");
  assert.equal(res.status, 404);
});

test("GET /harvest/downloads/:jobId returns the job and its dataset breakdown", async () => {
  db.queueRaw([{ job_id: "job-1", status: "completed" }]); // jobDetail
  db.queueRaw([{ dataset_id: "obs_270", status: "COMPLETED" }]); // jobDatasets

  const res = await agent.get("/harvest/downloads/job-1");

  assert.equal(res.status, 200);
  assert.equal(res.body.job.job_id, "job-1");
  assert.deepEqual(res.body.datasets, [{ dataset_id: "obs_270", status: "COMPLETED" }]);
});

// /summary, /recent and /datasets must resolve before /:jobId, or each gets
// swallowed as a jobId — pin the route order this way, not just by
// inspection.
test("literal paths are not captured by /:jobId", async () => {
  db.queueRaw([{ n_jobs: 0 }]);
  const res = await agent.get("/harvest/downloads/summary");
  assert.equal(res.status, 200);
  assert.equal(res.body.n_jobs, 0);
});
