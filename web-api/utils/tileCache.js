const { RESP_TYPES } = require("redis");
const { ensureConnected, markDown, withTimeout } = require("./redis");

/*
 * Cache for proxied basemap tiles: an in-process map (L1) in front of redis
 * (L2). L2 is redis directly rather than utils/cache, whose apicache adapter
 * String()s values and mangles image bytes; node-redis must also be told to
 * return Buffers (the type mapping in ensureRedis) or it corrupts them the
 * same way. The v4 idiom `commandOptions({ returnBuffers: true })` no longer
 * exists in v5 and would fail silently.
 */

// Served when upstream errors, so the map stays clean. A full 256x256 rather
// than 1x1 so MapLibre's texture upload needs no rescale.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==",
  "base64",
);

// One upstream blip must not blank the layer for long.
const ERROR_MAX_AGE_S = 60;

const L1_TTL_MS = 24 * 60 * 60 * 1000;

// The cache is an optimisation and must fail fast rather than hang the layer.
const REDIS_OP_TIMEOUT_MS = 1000;

async function ensureRedis() {
  const client = await ensureConnected();
  if (!client) return null;
  return client.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
}

function createTileCache(namespace, { l1Max, redisTtlS }) {
  const l1 = new Map();
  const redisKey = (key) => `${namespace}:tile:${key}`;

  function l1Get(key) {
    const hit = l1.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      l1.delete(key);
      return null;
    }
    // Re-insert so Map's insertion order doubles as LRU recency.
    l1.delete(key);
    l1.set(key, hit);
    return hit.body;
  }

  function l1Set(key, body) {
    if (l1.size >= l1Max) {
      l1.delete(l1.keys().next().value);
    }
    l1.set(key, { body, expires: Date.now() + L1_TTL_MS });
  }

  async function redisGet(key) {
    try {
      const client = await ensureRedis();
      if (!client) return null;
      const body = await withTimeout(
        client.get(redisKey(key)),
        REDIS_OP_TIMEOUT_MS,
        "redis get",
      );
      return Buffer.isBuffer(body) && body.length ? body : null;
    } catch (e) {
      markDown(`${namespace} tile read failed: ${e.message}`);
      return null;
    }
  }

  async function redisSet(key, body) {
    try {
      const client = await ensureRedis();
      if (!client) return;
      await withTimeout(
        client.setEx(redisKey(key), redisTtlS, body),
        REDIS_OP_TIMEOUT_MS,
        "redis set",
      );
    } catch (e) {
      markDown(`${namespace} tile write failed: ${e.message}`);
    }
  }

  return {
    async get(key) {
      const cached = l1Get(key);
      if (cached) return cached;
      const fromRedis = await redisGet(key);
      if (fromRedis) l1Set(key, fromRedis);
      return fromRedis;
    },
    set(key, body) {
      l1Set(key, body);
      // Not awaited: a slow redis must not hold up the response.
      redisSet(key, body);
    },
  };
}

function sendTile(res, body, contentType, maxAgeSeconds) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds}`);
  res.status(200).send(body);
}

function sendFallbackTile(res) {
  sendTile(res, TRANSPARENT_PNG, "image/png", ERROR_MAX_AGE_S);
}

module.exports = { createTileCache, sendTile, sendFallbackTile };
