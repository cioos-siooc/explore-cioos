const request = require("supertest");
const apicache = require("apicache");

const dbStub = require("./dbStub");
const redisStub = require("./redisStub");

// Call once per test file, at module scope: requiring ../app pulls in every
// route, so the stubs must already be in require.cache. Call db.reset() and
// resetCache() in beforeEach: apicache's in-memory store is process-wide, so
// a repeat path+query would get the previous test's response. Install
// test/axiosStub.js before this for routes that call upstream HTTP.
function createTestApp({ redisClient } = {}) {
  redisStub.install({ client: redisClient });
  const db = dbStub.install();
  const app = require("../app");
  return { app, agent: request(app), db, resetCache: () => apicache.clear() };
}

module.exports = { createTestApp };
