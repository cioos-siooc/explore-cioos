const apicache = require("apicache");
const redis = require("./redis");

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
        .hSet(key, field, typeof value === "string" ? value : String(value))
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

/*
 * The connect itself (single-flight, timeout, retry window) belongs to
 * utils/redis, which owns the client and has a second consumer in
 * routes/nonna. All this has to add is wiring the adapter into apicache once
 * redis is actually up.
 *
 * `adapterInstalled` is deliberately the only thing memoized. A failed connect
 * is NOT cached as a decision: this request degrades to apicache's in-memory
 * store, and the next one past redis's retry window tries again. The previous
 * version memoized the whole init including its failure, so one redis blip at
 * startup silently pinned the process to a per-process in-memory cache until
 * it was restarted.
 */
let adapterInstalled = false;

function createCache({ redis: redisModule = redis } = {}) {
  async function ensureReady() {
    const client = await redisModule.ensureConnected();
    if (client && !adapterInstalled) {
      // apicache is a singleton, so the adapter is process-global and must be
      // installed exactly once.
      apicache.options({ redisClient: apicacheRedisAdapter(client) });
      adapterInstalled = true;
      console.log("Cache: using Redis backend");
    }
    // Same middleware factory either way; when the adapter is set it uses
    // redis, otherwise apicache's built-in in-memory store.
    return apicache.middleware;
  }

  return {
    ensureReady,
    // `toggle` is apicache's middlewareToggle, forwarded verbatim. In apicache
    // 1.6.3 the pre-request toggle check is commented out, so it is consulted
    // in exactly two places, both with the response in hand:
    //   - shouldCacheResponse() — decides whether to STORE
    //   - sendCachedResponse()  — decides whether to SERVE a hit
    // That makes it the only way to keep error responses out of the cache:
    // `statusCodes` is read from globalOptions, so passing it as a per-route
    // localOption is silently ignored. On the serve path nothing has been
    // written yet, so res.statusCode is still the default 200 and a
    // `res.statusCode === 200` toggle correctly serves hits.
    route:
      (duration = "5 minutes", toggle) =>
      async (req, res, next) => {
        const mw = await ensureReady();
        return mw(duration, toggle)(req, res, next);
      },
  };
}

module.exports = {
  // Module surface stays exactly `route` for all 29 call sites across 17
  // routes; the factory is the seam tests use to drive both branches in one
  // process.
  route: createCache().route,
  createCache,
  // Ready-made toggle for routes that proxy an upstream which can fail: cache
  // the good answer, never the failure.
  onlyOk: (req, res) => res.statusCode === 200,
  // Test seam: apicache's adapter is process-global, so a test exercising the
  // redis branch has to be able to put that global back.
  _resetAdapterForTests: () => {
    adapterInstalled = false;
    // `false` is apicache's own default, i.e. "no redis, use the in-memory
    // store" — the state a process is genuinely in before the first connect.
    apicache.options({ redisClient: false });
  },
};
