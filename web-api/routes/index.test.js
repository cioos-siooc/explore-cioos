const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

let redisDown = false;
const redisClient = {
  ping: async () => {
    if (redisDown) throw new Error("ECONNREFUSED");
    return "PONG";
  },
};
const { agent, db } = createTestApp({ redisClient });

test.beforeEach(() => {
  db.reset();
  redisDown = false;
});

test("GET / reports the API is running", async () => {
  const res = await agent.get("/");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { name: "CDE API", status: "ok" });
});

test("GET /health never touches Postgres or Redis", async () => {
  const res = await agent.get("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("GET /health/ready is ok when db, redis and the download queue are", async () => {
  db.queueRaw([{ oldest_open_seconds: 12 }]);
  const res = await agent.get("/health/ready");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.deepEqual(res.body.checks.downloadQueue, {
    ok: true,
    oldestOpenSeconds: 12,
  });
});

test("GET /health/ready is ok with an empty download queue", async () => {
  db.queueRaw([{ oldest_open_seconds: null }]);
  const res = await agent.get("/health/ready");
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.downloadQueue.ok, true);
});

test("GET /health/ready is 503 when Postgres is unreachable", async () => {
  db.queueError(new Error("connect ECONNREFUSED"));
  const res = await agent.get("/health/ready");
  assert.equal(res.status, 503);
  assert.equal(res.body.status, "down");
  assert.equal(res.body.checks.db.ok, false);
  assert.equal(res.body.checks.downloadQueue.ok, false);
});

test("GET /health/ready is 503 when an open download job is stuck", async () => {
  db.queueRaw([{ oldest_open_seconds: 301 }]);
  const res = await agent.get("/health/ready");
  assert.equal(res.status, 503);
  assert.equal(res.body.checks.db.ok, true);
  assert.equal(res.body.checks.downloadQueue.ok, false);
});

test("GET /health/ready is only degraded when Redis is down", async () => {
  redisDown = true;
  db.queueRaw([{ oldest_open_seconds: null }]);
  const res = await agent.get("/health/ready");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "degraded");
  assert.equal(res.body.checks.redis.ok, false);
});

test("GET /sentry-test always throws, answered by the shared error handler", async () => {
  const res = await agent.get("/sentry-test");
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Testing sentry");
});

test("an unknown route 404s through the shared error handler", async () => {
  const res = await agent.get("/this-route-does-not-exist");
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});
