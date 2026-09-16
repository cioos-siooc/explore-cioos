const request = require("supertest");
const apicache = require("apicache");

const dbStub = require("./dbStub");
const redisStub = require("./redisStub");

/**
 * Boots the real Express app (app.js — real validation, real apicache
 * middleware, real error handler) with Postgres and Redis both stubbed out,
 * wrapped in a supertest agent.
 *
 * Call ONCE per test file, at module scope, before any `test()` — requiring
 * "../app" is what pulls in every route file (and transitively utils/cache.js,
 * utils/routePipeline.js), so the db/redis stubs below must already be sitting
 * in require.cache by then. node's test runner gives each test FILE its own
 * process, so this require.cache surgery never leaks into another file.
 *
 * Returns `db` (see dbStub.js) for queuing what Postgres "returns" — queue the
 * next call's result with db.queueRaw()/queueRows()/queueError() before
 * issuing a request, and call db.reset() between tests (e.g. in
 * test.beforeEach) so a call left un-queued from a previous test can't answer
 * a later one.
 *
 * Also returns resetCache(), which every cached route (anything using
 * pipeline()'s default cacheFor) needs calling in the same beforeEach: with
 * redis unavailable, apicache falls back to its own in-process store, which is
 * a process-wide singleton — a second test hitting the same path+query inside
 * one test file would otherwise get back the FIRST test's response instead of
 * running the handler (and consuming what this test just queued on db) at
 * all.
 *
 * For routes that also call ERDDAP (preview.js) or an upstream WMTS (nonna.js),
 * install test/axiosStub.js yourself, BEFORE calling createTestApp — same
 * ordering rule, since axios is required by those route files too.
 */
function createTestApp() {
  redisStub.install();
  const db = dbStub.install();
  const app = require("../app");
  return { app, agent: request(app), db, resetCache: () => apicache.clear() };
}

module.exports = { createTestApp };
