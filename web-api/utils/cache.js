const apicache = require('apicache');

const cacheConfigured = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

let middleware;
let initPromise;

function apicacheOptions() {
  return {
    headers: {
      'cache-control': (req, res) => res.get('Cache-Control') || 'public, max-age=300',
    },
  };
}

// Pass-through middleware used when caching is disabled (dev) or Redis is unavailable.
function passthrough() {
  return (_req, _res, next) => next();
}

async function initialize() {
  if (!cacheConfigured) {
    console.log('Cache: disabled (no REDIS_HOST/REDIS_URL set)');
    return () => passthrough();
  }

  // Lazy-require so dev runs without the redis client active.
  const redisClient = require('./redis');
  try {
    await redisClient.connect();
    // connect() can succeed before AUTH is exercised; PING surfaces auth errors.
    await redisClient.ping();
    console.log('Cache: using Redis backend');
    return apicache.options({ ...apicacheOptions(), redisClient }).middleware;
  } catch (e) {
    try { await redisClient.disconnect(); } catch (_) { /* ignore */ }
    console.warn('Cache: Redis unavailable, using in-memory cache:', e.message);
    return apicache.options(apicacheOptions()).middleware;
  }
}

async function ensureReady() {
  if (middleware) return middleware;
  if (!initPromise) initPromise = initialize();
  middleware = await initPromise;
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
