const apicache = require('apicache');
const redisClient = require('./redis');

let middleware; // initialized on first request

// No `headers` override: apicache's `headers` option only takes literal header
// strings (a function here gets stringified into the response, producing an
// invalid Cache-Control the browser discards — so tiles were re-fetched on
// every map pan). Left unset, apicache emits a valid
// `cache-control: max-age=<duration>` on its own.
async function ensureReady() {
  if (middleware) return middleware;

  try {
    await redisClient.connect(); // redis@4 connect is idempotent
    middleware = apicache.options({ redisClient }).middleware;
    console.log('Cache: using Redis backend');
  } catch (e) {
    console.warn('Cache: Redis unavailable, using in-memory cache:', e.message);
    middleware = apicache.middleware;
  }
  return middleware;
}

module.exports = {
  route: (duration = '5 minutes') => {
    return async (req, res, next) => {
      const mw = await ensureReady();
      return mw(duration)(req, res, next);
    };
  },
};

