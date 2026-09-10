const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent } = createTestApp();

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
