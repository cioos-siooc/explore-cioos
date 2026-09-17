const zlib = require("node:zlib");

const apicache = require("apicache");
const redis = require("./redis");

/*
 * Cached bodies are stored compressed.
 *
 * apicache hands us the whole cache object as one JSON string under the
 * `response` field, and JSON.stringify turns a Buffer body — every .mvt tile —
 * into {"type":"Buffer","data":[12,34,...]}, one byte per 3-4 ASCII chars. A
 * z3 tile measured 42 KB raw and 123 KB stored; /api/datasets, 717 KB of JSON,
 * stored as 2.5 MB, i.e. one key for 2.5% of a 100mb cache. Measured against
 * prod payloads, gzip+base64 gives ~6x on tiles and ~29x on the JSON catalog
 * routes, which is what makes the warm set fit (see redis-config/redis.conf).
 *
 * Nothing on the wire changes: nginx does the client-facing gzip (nginx.conf),
 * express runs no compression middleware, so this is purely how the bytes sit
 * in redis.
 *
 * base64 rather than raw deflate bytes because the adapter's contract with
 * redis@5 here is string-valued; it costs 33% back and keeps the client's
 * default encoding binary-safe with no reconfiguration.
 *
 * SYNCHRONOUS on purpose. apicache issues hset(response) -> hset(duration) ->
 * expire(key) back to back, relying on each having queued its command before
 * the next runs. Deferring the compression to a callback would let EXPIRE
 * reach redis before the key existed — it would return 0, the TTL would never
 * be set, and the entry would sit there until eviction. The cost lands on the
 * miss path, which has just spent seconds in Postgres.
 */
const COMPRESSED_PREFIX = "gz:";

function packResponse(value) {
  return COMPRESSED_PREFIX + zlib.gzipSync(value).toString("base64");
}

// Anything without the marker is passed through: an entry written before this
// landed, or by a rolled-back build, still reads.
function unpackResponse(value) {
  if (typeof value !== "string" || !value.startsWith(COMPRESSED_PREFIX)) {
    return value;
  }
  const payload = Buffer.from(value.slice(COMPRESSED_PREFIX.length), "base64");
  return zlib.gunzipSync(payload).toString();
}

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
      const stored = typeof value === "string" ? value : String(value);
      client
        .hSet(key, field, field === "response" ? packResponse(stored) : stored)
        .then((res) => cb && cb(null, res))
        .catch((err) => cb && cb(err));
    },
    hgetall(key, cb) {
      // redis@5 returns {} for a missing key; apicache checks `obj && obj.response`
      // so an empty object correctly reads as a miss.
      client
        .hGetAll(key)
        .then((obj) => {
          if (!obj || !obj.response) return cb(null, obj);
          // A body we cannot unpack is reported as a miss rather than thrown:
          // apicache parses this inside its own callback, where a throw would
          // escape as an unhandled exception. A miss just regenerates it.
          try {
            cb(null, { ...obj, response: unpackResponse(obj.response) });
          } catch (err) {
            console.warn(`Cache: dropping unreadable entry for ${key}`, err);
            cb(null, {});
          }
        })
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
