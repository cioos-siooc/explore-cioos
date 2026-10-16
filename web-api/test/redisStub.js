const Module = require("node:module");

// Must install before utils/cache.js (binds its redis module at load) or
// routes/nonna.js is required. Defaults to redis never available, so routes
// fall through to apicache's in-memory store.
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
