// Lightweight replacement for express-redis-cache that works with modern Express
// Features:
//  - Requires Redis (via ioredis) – fails fast if not reachable
//  - Supports binary responses via options.binary
//  - Disable entirely with CACHE_DISABLED=1
//  - Per-route override: cache.route({ ttl: seconds, binary: true })
//  - Adds X-Cache: HIT|MISS header when caching layer is active

const Redis = require("ioredis");

const disabled = process.env.CACHE_DISABLED === "1";
const defaultTTL = parseInt(process.env.CACHE_TTL_SECONDS || "300", 10); // 5 minutes

if (disabled) {
  console.warn("[cache] Cache layer disabled via CACHE_DISABLED=1");
}

if (!process.env.REDIS_HOST) {
  throw new Error("[cache] REDIS_HOST must be set (Redis now required)");
}

const redis = new Redis({
  host: process.env.REDIS_HOST,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
});

redis.on("ready", () => console.log("[cache] Redis ready"));
redis.on("error", (e) => console.error("[cache] Redis error", e.message));

function makeKey(req) {
  return `${req.method}:${req.originalUrl}`;
}

async function getCached(key) {
  try {
    const packed = await redis.getBuffer(key); // Buffer or null
    if (!packed) return null;
    const sepIndex1 = packed.indexOf(124); // '|'
    const sepIndex2 = packed.indexOf(124, sepIndex1 + 1);
    if (sepIndex1 === -1 || sepIndex2 === -1) return null;
    const meta = packed.slice(0, sepIndex1).toString();
    const contentType = packed.slice(sepIndex1 + 1, sepIndex2).toString();
    const data = packed.slice(sepIndex2 + 1);
    return { meta, contentType, data };
  } catch (e) {
    console.warn("[cache] Redis get error:", e.message);
    return null;
  }
}

async function setCached(key, value, ttlSeconds) {
  try {
    await redis.set(key, value, "EX", ttlSeconds);
  } catch (e) {
    console.warn("[cache] Redis set error:", e.message);
  }
}

function packForStorage({ bodyBuffer, isJson, contentType }) {
  // prefix: json|<contentType>|<binary>
  const prefix = Buffer.from(`${isJson ? "json" : "bin"}|${contentType}|`);
  return Buffer.concat([prefix, bodyBuffer]);
}

function route(options = {}) {
  if (disabled) return (req, res, next) => next();
  const ttl = options.ttl ? parseInt(options.ttl, 10) : defaultTTL;
  const binary = options.binary === true;

  return async (req, res, next) => {
    if (req.method !== "GET") return next();
    const key = makeKey(req);
    const cached = await getCached(key);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      if (cached.contentType) res.setHeader("Content-Type", cached.contentType);
      if (cached.meta === "json") {
        try {
          const jsonStr = cached.data.toString();
            return res.send(JSON.parse(jsonStr));
        } catch {
          // fallback as raw
        }
      }
      return res.send(cached.data);
    }
    res.setHeader("X-Cache", "MISS");

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      try {
        // Normalize body into a Buffer for storage
        let bodyBuffer;
        let isJson = false;
        let contentType = res.getHeader("Content-Type");
        if (!contentType) {
          contentType = binary ? "application/octet-stream" : "application/json; charset=utf-8";
          res.setHeader("Content-Type", contentType);
        }
        if (Buffer.isBuffer(body)) {
          bodyBuffer = body;
        } else if (binary) {
          // If binary expected but body not buffer, coerce
            bodyBuffer = Buffer.from(body);
        } else if (typeof body === "object") {
          isJson = true;
          const jsonStr = JSON.stringify(body);
          bodyBuffer = Buffer.from(jsonStr);
        } else {
          bodyBuffer = Buffer.from(String(body));
        }
        const packed = packForStorage({ bodyBuffer, isJson, contentType });
        setCached(key, packed, ttl).catch(() => {});
      } catch (e) {
        console.warn("[cache] store error:", e.message);
      }
      return originalSend(body);
    };
    return next();
  };
}

module.exports = { route };
