const apicache = require('apicache');
const redisClient = require('./redis');

let middlewarePromise; // single-flight init (see ensureReady)

// apicache 1.6.3 speaks the node_redis v2/v3 client API: it gates every cache
// read AND write on `redis.connected` and calls callback-style
// `hset/hgetall/expire/del`. Our client is redis@5, whose API is
// `isReady`/`hSet`/`hGetAll`/… (promises, camelCase) and which has NO
// `.connected`/`.hgetall`/`.hset`. Passed raw, apicache's
// `if (redis && redis.connected)` is always false, so NOTHING is ever cached and
// every request recomputes against Postgres (verified: redis DBSIZE stayed 0).
// This adapter exposes exactly the surface apicache uses, delegating to the
// promise API. It is the only thing that makes the redis cache actually cache.
function apicacheRedisAdapter(client) {
  return {
    // apicache reads this as a plain boolean on every hit/store.
    get connected() {
      return client.isReady;
    },
    // Fire-and-forget in apicache (no callback passed for the stores); accept an
    // optional cb anyway. Values must be strings for redis@5's hSet.
    hset(key, field, value, cb) {
      client
        .hSet(key, field, typeof value === 'string' ? value : String(value))
        .then((res) => cb && cb(null, res))
        .catch((err) => cb && cb(err));
    },
    hgetall(key, cb) {
      // redis@5 returns {} for a missing key; apicache checks `obj && obj.response`
      // so an empty object correctly reads as a miss.
      client
        .hGetAll(key)
        .then((obj) => cb(null, obj))
        .catch((err) => cb(err));
    },
    expire(key, seconds, cb) {
      // apicache passes duration(ms)/1000; EXPIRE needs a positive integer.
      client
        .expire(key, Math.max(1, Math.round(seconds)))
        .then((res) => cb && cb(null, res))
        .catch((err) => cb && cb(err));
    },
    del(key, cb) {
      client
        .del(key)
        .then((res) => cb && cb(null, res))
        .catch((err) => cb && cb(err));
    },
  };
}

// No `headers` override: apicache's `headers` option only takes literal header
// strings (a function here gets stringified into the response, producing an
// invalid Cache-Control the browser discards — so tiles were re-fetched on
// every map pan). Left unset, apicache emits a valid
// `cache-control: max-age=<duration>` on its own.
//
// Single-flight: concurrent first requests must not each call
// redisClient.connect() — redis@5 throws "Socket already opened" on the 2nd
// call, which previously dropped us onto the per-process in-memory cache
// inconsistently. Memoize the whole init as one promise.
function ensureReady() {
  if (middlewarePromise) return middlewarePromise;
  middlewarePromise = (async () => {
    try {
      if (!redisClient.isOpen) await redisClient.connect();
      apicache.options({ redisClient: apicacheRedisAdapter(redisClient) });
      console.log('Cache: using Redis backend');
    } catch (e) {
      console.warn('Cache: Redis unavailable, using in-memory cache:', e.message);
    }
    // Same middleware factory either way; when the adapter is set it uses redis,
    // otherwise apicache's built-in in-memory store.
    return apicache.middleware;
  })();
  return middlewarePromise;
}

module.exports = {
  // `toggle` is apicache's middlewareToggle, forwarded verbatim. In apicache
  // 1.6.3 the pre-request toggle check is commented out, so it is consulted in
  // exactly two places, both with the response in hand:
  //   - shouldCacheResponse() — decides whether to STORE
  //   - sendCachedResponse()  — decides whether to SERVE a hit
  // That makes it the only way to keep error responses out of the cache:
  // `statusCodes` is read from globalOptions, so passing it as a per-route
  // localOption is silently ignored. On the serve path nothing has been written
  // yet, so res.statusCode is still the default 200 and a
  // `res.statusCode === 200` toggle correctly serves hits.
  route: (duration = '5 minutes', toggle) => {
    return async (req, res, next) => {
      const mw = await ensureReady();
      return mw(duration, toggle)(req, res, next);
    };
  },
  // Ready-made toggle for routes that proxy an upstream which can fail: cache
  // the good answer, never the failure.
  onlyOk: (req, res) => res.statusCode === 200,
};
