const apicache = require('apicache');
const redisClient = require('./redis');

let middleware; // initialized on first request

function apicacheOptions() {
  return {
    // Don’t leak internal headers; set a sane default Cache-Control if route didn’t set one
    headers: {
      'cache-control': (req, res) => res.get('Cache-Control') || 'public, max-age=300',
    },
  };
}

async function ensureReady() {
  if (middleware) return middleware;

  try {
    await redisClient.connect(); // redis@4 connect is idempotent
    middleware = apicache.options({ ...apicacheOptions(), redisClient }).middleware;
    console.log('Cache: using Redis backend');
  } catch (e) {
    console.warn('Cache: Redis unavailable, using in-memory cache:', e.message);
    middleware = apicache.options(apicacheOptions()).middleware;
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

