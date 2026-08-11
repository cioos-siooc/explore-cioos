require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { RESP_TYPES } = require("redis");
const redisClient = require("../utils/redis");

const router = express.Router();

/*
 * /nonna/:layer/:z/:x/:y.png
 *
 * Server-side proxy for CHS NONNA bathymetry tiles.
 *
 * Why this exists at all: NONNA's GeoServer sits behind a gateway that
 * allowlists request origins EXACTLY. A request carrying
 * `Origin: https://data.chs-shc.ca` gets 200 plus a matching
 * access-control-allow-origin; every other origin — explore.cioos.ca, any
 * localhost, even foo.data.chs-shc.ca — gets a bare 403, and so does the CORS
 * preflight. Because the gateway sets access-control-allow-credentials: true it
 * cannot answer with a wildcard, so origins have to be enumerated one by one.
 *
 * That is fatal for the browser but invisible from here: a server-side request
 * sends no Origin header, and no-Origin requests return 200. Node fetches the
 * tile, Express serves it same-origin with the API's own CORS headers, and
 * MapLibre is happy.
 *
 * It is specifically MapLibre that needs this. It sets
 * `image.crossOrigin = 'anonymous'` on every cross-origin tile, so an Origin
 * header always goes out, and WebGL refuses to upload a non-origin-clean image
 * to a texture — there is no opt-out. A Leaflet/OpenLayers `<img>` tile layer
 * sends no Origin and can still load NONNA directly today, which is why this
 * used to work before the map moved to MapLibre.
 *
 * If CHS ever allowlists the explore.cioos.ca origin, this route can be deleted
 * and the frontend pointed straight at the upstream URL.
 */

const NONNA_WMTS = "https://nonna-geoserver.data.chs-shc.ca/geoserver/gwc/service/wmts";

// The two published grids. NONNA 10 is the 10 m product — sharp enough at z16
// to show individual wharves — but it only covers surveyed areas; NONNA 100 is
// the 100 m product with broader coverage. Requests for anything else are
// rejected here rather than forwarded, so this cannot be used to bounce
// arbitrary requests off the API.
const LAYERS = {
  10: "nonna:NONNA 10",
  100: "nonna:NONNA 100",
};

// GeoWebCache's Web Mercator gridset. Its tile indices are the ordinary XYZ
// ones (top-left origin), so {z}/{x}/{y} maps straight onto
// tilematrix/tilecol/tilerow — verified against Halifax harbour.
const TILE_MATRIX_SET = "EPSG:900913";

const MAX_ZOOM = 21;
const UPSTREAM_TIMEOUT_MS = 15000;

// Upstream answers 200 with a fully transparent PNG wherever it holds no data
// (outside Canadian waters, unsurveyed areas, past its deepest level), so
// out-of-coverage needs no special handling. This is only for the case where
// upstream is unreachable or errors: serving a transparent tile keeps the map
// clean instead of painting MapLibre's error state over the water.
// A full 256x256 rather than a 1x1: MapLibre uploads whatever it gets straight
// to a texture, so matching the tile size avoids any rescale on the error path.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==",
  "base64",
);

// Tiles are static, so they cache hard. A week in the browser; the in-process
// cache below is what spares the upstream on cold clients.
const BROWSER_MAX_AGE_S = 604800;
// A failed fetch must NOT be cached for a week — one upstream blip would blank
// the layer for every visitor until the header expired.
const ERROR_MAX_AGE_S = 60;

/*
 * Two cache levels: a small in-process map (L1) in front of redis (L2).
 *
 * L2 is redis directly rather than utils/cache. The apicache path there stores
 * through an adapter doing `typeof value === 'string' ? value : String(value)`,
 * and String()-ing a Buffer decodes it as UTF-8, which mangles PNG bytes —
 * measured: an 18,896-byte tile came back as a 34,517-byte string with a
 * different md5. Talking to redis directly avoids that, but only if the read
 * side is told to hand back Buffers: node-redis decodes replies as strings by
 * default and would corrupt them the same way. Hence the type mapping below —
 * verified byte-identical (md5 match) on a round trip through redis 5.8.
 * Note `commandOptions({ returnBuffers: true })`, the node-redis v4 idiom, no
 * longer exists in v5; it is `undefined`, so it would fail silently.
 *
 * L2 is what makes pre-warming a region worthwhile: it survives restarts, is
 * shared across API instances, and is bounded by redis's own maxmemory policy
 * rather than this process's heap. Warming a whole region needs redis sized for
 * it — the full pyramid for both products is a few hundred GB, so warm regions,
 * not the country.
 *
 * L1 sizing: measured tiles run ~5-40 KB, so the 3000 default is ~120 MB at the
 * absolute worst (every entry a dense 40 KB NONNA 10 tile) and more like 40-60
 * MB in practice. Override with NONNA_TILE_CACHE_MAX where the container is
 * memory-tight.
 */
const TILE_CACHE_MAX = Number(process.env.NONNA_TILE_CACHE_MAX) > 0
  ? Number(process.env.NONNA_TILE_CACHE_MAX)
  : 3000;
const TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const tileCache = new Map();

function cacheGet(key) {
  const hit = tileCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    tileCache.delete(key);
    return null;
  }
  // Re-insert so Map's insertion order doubles as LRU recency.
  tileCache.delete(key);
  tileCache.set(key, hit);
  return hit.body;
}

function cacheSet(key, body) {
  if (tileCache.size >= TILE_CACHE_MAX) {
    const oldest = tileCache.keys().next().value;
    tileCache.delete(oldest);
  }
  tileCache.set(key, { body, expires: Date.now() + TILE_CACHE_TTL_MS });
}

// Tiles are static: CHS republishes NONNA on a slow cycle, so a month is safe
// and keeps a warmed region warm.
const REDIS_TTL_S = 30 * 24 * 60 * 60;
const redisKey = (key) => `nonna:tile:${key}`;

/*
 * Every redis call is bounded. node-redis keeps retrying a refused connection
 * under its default reconnect strategy, so an un-raced `await connect()` never
 * settles when redis is down — which stalls the tile request behind it and
 * hangs the layer. The cache is an optimisation; it must fail in milliseconds,
 * not hold the map hostage.
 */
const REDIS_CONNECT_TIMEOUT_MS = 2000;
const REDIS_OP_TIMEOUT_MS = 1000;
// After a failure, stop trying for a while rather than paying the timeout on
// every tile — but do retry eventually, so a redis that comes back is picked up
// without restarting the API.
const REDIS_RETRY_AFTER_MS = 60000;

let redisReadyPromise = null;
let redisUnavailableUntil = 0;

function withTimeout(promise, ms, label) {
  let timer;
  const bell = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    // Don't let a pending timer keep the process alive.
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
}

function markRedisDown(reason) {
  console.warn("NONNA: redis unavailable, serving without it:", reason);
  redisUnavailableUntil = Date.now() + REDIS_RETRY_AFTER_MS;
  redisReadyPromise = null;
}

/*
 * Resolves to a redis client that returns Buffers, or null if redis is not
 * usable right now.
 *
 * The connect is single-flight for the reason utils/cache documents: redis@5
 * throws "Socket already opened" on a second connect(). That module races this
 * one at startup on the SAME shared client, so `isOpen` can still be false
 * while its connect is in flight — hence catching that specific error and
 * carrying on rather than treating it as a failure.
 */
function ensureRedis() {
  if (Date.now() < redisUnavailableUntil) return Promise.resolve(null);
  if (redisReadyPromise) return redisReadyPromise;
  redisReadyPromise = (async () => {
    try {
      if (!redisClient.isOpen) {
        await withTimeout(
          redisClient.connect(),
          REDIS_CONNECT_TIMEOUT_MS,
          "redis connect",
        );
      }
    } catch (e) {
      if (!/already opened/i.test(e.message) || !redisClient.isOpen) {
        markRedisDown(e.message);
        return null;
      }
    }
    return redisClient.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
  })();
  return redisReadyPromise;
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
    markRedisDown(`read failed: ${e.message}`);
    return null;
  }
}

async function redisSet(key, body) {
  try {
    const client = await ensureRedis();
    if (!client) return;
    await withTimeout(
      client.setEx(redisKey(key), REDIS_TTL_S, body),
      REDIS_OP_TIMEOUT_MS,
      "redis set",
    );
  } catch (e) {
    markRedisDown(`write failed: ${e.message}`);
  }
}

function sendTile(res, body, maxAgeSeconds) {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds}`);
  res.status(200).send(body);
}

/**
 * @swagger
 * /nonna/{layer}/{z}/{x}/{y}.png:
 *   get:
 *     summary: Proxy a CHS NONNA bathymetry raster tile
 *     tags: [Nonna]
 *     description: >
 *       Fetches a Canadian Hydrographic Service NONNA bathymetry tile from the
 *       CHS GeoServer and re-serves it same-origin. CHS allowlists request
 *       origins exactly and 403s everything else, including the CORS preflight,
 *       so the browser cannot load these tiles directly; a server-side request
 *       sends no Origin header and succeeds. Tiles are transparent over land and
 *       wherever CHS holds no data, so the result composites directly over
 *       satellite imagery.
 *     parameters:
 *       - in: path
 *         name: layer
 *         required: true
 *         description: NONNA product resolution in metres.
 *         schema: { type: string, enum: ["10", "100"] }
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: PNG tile, transparent where CHS holds no data.
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Unknown layer, or tile coordinates outside the zoom's grid.
 */
/* GET /nonna/:layer/:z/:x/:y.png */
router.get("/:layer/:z/:x/:y.png", async (req, res) => {
  const {
    layer, z, x, y,
  } = req.params;

  const wmtsLayer = LAYERS[layer];
  if (!wmtsLayer) {
    return res
      .status(400)
      .json({ error: `unknown NONNA layer '${layer}'; expected 10 or 100` });
  }

  const zoom = Number(z);
  const col = Number(x);
  const row = Number(y);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > MAX_ZOOM) {
    return res.status(400).json({ error: `zoom must be an integer 0-${MAX_ZOOM}` });
  }
  // Reject out-of-grid indices rather than forwarding them: upstream would
  // answer anyway, and each forwarded request is one we made CHS serve.
  const tilesPerAxis = 2 ** zoom;
  if (
    !Number.isInteger(col) || col < 0 || col >= tilesPerAxis
    || !Number.isInteger(row) || row < 0 || row >= tilesPerAxis
  ) {
    return res
      .status(400)
      .json({ error: `tile ${col}/${row} is outside the grid at zoom ${zoom}` });
  }

  const key = `${layer}/${zoom}/${col}/${row}`;
  const cached = cacheGet(key);
  if (cached) {
    return sendTile(res, cached, BROWSER_MAX_AGE_S);
  }

  // L2. Promote into L1 on the way out so a region being panned around does not
  // pay the redis round trip per tile.
  const fromRedis = await redisGet(key);
  if (fromRedis) {
    cacheSet(key, fromRedis);
    return sendTile(res, fromRedis, BROWSER_MAX_AGE_S);
  }

  try {
    const upstream = await axios.get(NONNA_WMTS, {
      params: {
        service: "WMTS",
        version: "1.0.0",
        request: "GetTile",
        layer: wmtsLayer,
        style: "",
        tilematrixset: TILE_MATRIX_SET,
        format: "image/png",
        tilematrix: `${TILE_MATRIX_SET}:${zoom}`,
        tilerow: row,
        tilecol: col,
      },
      responseType: "arraybuffer",
      timeout: UPSTREAM_TIMEOUT_MS,
    });

    const body = Buffer.from(upstream.data);
    cacheSet(key, body);
    // Not awaited: the tile is already in hand, and a slow or dead redis must
    // not hold up the response. redisSet swallows its own errors.
    redisSet(key, body);
    return sendTile(res, body, BROWSER_MAX_AGE_S);
  } catch (e) {
    // A 403 here means CHS changed the allowlist or the gateway rules; anything
    // else is a timeout or an upstream error. Either way the map should stay
    // usable, so serve a transparent tile on a short TTL.
    console.error(
      `NONNA tile ${key} failed:`,
      e.response ? `upstream ${e.response.status}` : e.message,
    );
    return sendTile(res, TRANSPARENT_PNG, ERROR_MAX_AGE_S);
  }
});

module.exports = router;
