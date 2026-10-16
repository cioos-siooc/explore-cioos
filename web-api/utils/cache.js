const zlib = require("node:zlib");

const apicache = require("apicache");
const redis = require("./redis");

// Stored gzip+base64: JSON.stringify turns a Buffer body into one number per
// byte (~6x on tiles, ~29x on JSON catalogs, needed for the warm set to fit
// redis-config/redis.conf). Synchronous on purpose: apicache issues
// hset -> hset -> expire back to back, and deferred compression would let
// EXPIRE run before the key exists, leaving it with no TTL.
const COMPRESSED_PREFIX = "gz:";

function packResponse(value) {
  return COMPRESSED_PREFIX + zlib.gzipSync(value).toString("base64");
}

// Unprefixed entries (written by an older build) pass through.
function unpackResponse(value) {
  if (typeof value !== "string" || !value.startsWith(COMPRESSED_PREFIX)) {
    return value;
  }
  const payload = Buffer.from(value.slice(COMPRESSED_PREFIX.length), "base64");
  return zlib.gunzipSync(payload).toString();
}

// apicache 1.6.3 speaks the node_redis v2/v3 API (`connected`, callback
// `hset/hgetall/expire/del`); redis@5 has none of it, so passed raw nothing
// is ever cached. This adapter exposes exactly the surface apicache uses.
function apicacheRedisAdapter(client) {
  return {
    get connected() {
      return client.isReady;
    },
    // Values must be strings for redis@5's hSet.
    hset(key, field, value, cb) {
      const stored = typeof value === "string" ? value : String(value);
      client
        .hSet(key, field, field === "response" ? packResponse(stored) : stored)
        .then((res) => cb && cb(null, res))
        .catch((err) => cb && cb(err));
    },
    hgetall(key, cb) {
      client
        .hGetAll(key)
        .then((obj) => {
          if (!obj || !obj.response) return cb(null, obj);
          // apicache parses inside its own callback, where a throw would be
          // an unhandled exception; a miss just regenerates the entry.
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
      // EXPIRE needs a positive integer.
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

// No `headers` option: it only takes literal strings; a function gets
// stringified into an invalid Cache-Control. Unset, apicache emits a valid
// max-age on its own.

// Only the adapter install is memoized, never a failed connect, so a redis
// blip at startup degrades to the in-memory store instead of pinning to it.
let adapterInstalled = false;

function createCache({ redis: redisModule = redis } = {}) {
  async function ensureReady() {
    const client = await redisModule.ensureConnected();
    if (client && !adapterInstalled) {
      apicache.options({ redisClient: apicacheRedisAdapter(client) });
      adapterInstalled = true;
      console.log("Cache: using Redis backend");
    }
    return apicache.middleware;
  }

  return {
    ensureReady,
    // In apicache 1.6.3 `toggle` is only consulted when storing and serving
    // (with the response in hand), and per-route `statusCodes` is ignored, so
    // the toggle is the only way to keep errors out of the cache. On the serve
    // path res.statusCode is still the default 200.
    route:
      (duration = "5 minutes", toggle) =>
      async (req, res, next) => {
        const mw = await ensureReady();
        return mw(duration, toggle)(req, res, next);
      },
  };
}

module.exports = {
  route: createCache().route,
  createCache,
  onlyOk: (req, res) => res.statusCode === 200,
  // apicache's adapter is process-global.
  _resetAdapterForTests: () => {
    adapterInstalled = false;
    // apicache's default: no redis, use the in-memory store.
    apicache.options({ redisClient: false });
  },
};
