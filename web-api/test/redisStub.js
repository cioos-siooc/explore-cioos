const Module = require("node:module");

// Stands in for ../utils/redis so route tests never attempt a real
// connection to localhost:6379. Must run before anything requires
// utils/cache.js (which binds `createCache().route` — apicache's middleware
// factory — once, at module-load time, off whatever redis module is current
// in require.cache then) or routes/nonna.js (which imports
// ensureConnected/markDown/withTimeout directly).
//
// Defaults to "redis never available" (ensureConnected resolves null), which
// is what makes every route fall through to apicache's in-memory store /
// nonna's L1-only cache — deterministic and instant, no network involved.
const redisPath = require.resolve("../utils/redis");

function install({ client = null } = {}) {
  const stub = new Module(redisPath, null);
  stub.filename = redisPath;
  stub.loaded = true;
  stub.exports = {
    client: client || { isReady: false },
    ensureConnected: async () => client,
    markDown: () => {},
    withTimeout: (promise) => promise,
    RETRY_AFTER_MS: 60000,
  };
  require.cache[redisPath] = stub;
}

module.exports = { install, redisPath };
