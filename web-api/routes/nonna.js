require("dotenv").config({ quiet: true });
const express = require("express");
const axios = require("axios");
const { RESP_TYPES } = require("redis");
const { ensureConnected, markDown, withTimeout } = require("../utils/redis");
const { pipeline } = require("../utils/routePipeline");

const router = express.Router();

/*
 * NONNA's gateway allowlists request origins exactly and 403s every other
 * Origin, including the CORS preflight. MapLibre always sends an Origin
 * (crossOrigin = 'anonymous', required for WebGL textures), while a
 * server-side request sends none and succeeds. If CHS ever allowlists
 * explore.cioos.ca, this route can be deleted.
 */

const NONNA_WMTS =
  "https://nonna-geoserver.data.chs-shc.ca/geoserver/gwc/service/wmts";

// Allowlisted so this cannot be used to bounce arbitrary requests off the API.
const LAYERS = {
  10: "nonna:NONNA 10",
  100: "nonna:NONNA 100",
};

// Its tile indices are ordinary XYZ (top-left origin), so {z}/{x}/{y} maps
// straight onto tilematrix/tilecol/tilerow.
const TILE_MATRIX_SET = "EPSG:900913";

const MAX_ZOOM = 21;
const UPSTREAM_TIMEOUT_MS = 15000;

// Served when upstream errors, so the map stays clean. A full 256x256 rather
// than 1x1 so MapLibre's texture upload needs no rescale.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==",
  "base64",
);

const BROWSER_MAX_AGE_S = 604800;
// One upstream blip must not blank the layer for a week.
const ERROR_MAX_AGE_S = 60;

/*
 * An in-process map (L1) in front of redis (L2). L2 is redis directly rather
 * than utils/cache, whose apicache adapter String()s values and mangles PNG
 * bytes; node-redis must also be told to return Buffers (the type mapping in
 * ensureRedis) or it corrupts them the same way. The v4 idiom
 * `commandOptions({ returnBuffers: true })` no longer exists in v5 and would
 * fail silently.
 *
 * L1: tiles run ~5-40 KB, so the 3000 default is ~120 MB at worst.
 */
const TILE_CACHE_MAX =
  Number(process.env.NONNA_TILE_CACHE_MAX) > 0
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

// CHS republishes NONNA on a slow cycle, so a month is safe.
const REDIS_TTL_S = 30 * 24 * 60 * 60;
const redisKey = (key) => `nonna:tile:${key}`;

// The tile cache is an optimisation and must fail fast rather than hang the
// bathymetry layer.
const REDIS_OP_TIMEOUT_MS = 1000;

async function ensureRedis() {
  const client = await ensureConnected();
  if (!client) return null;
  return client.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
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
    markDown(`NONNA tile read failed: ${e.message}`);
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
    markDown(`NONNA tile write failed: ${e.message}`);
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
// No apicache: this route runs its own two-tier tile cache.
router.get(
  "/:layer/:z/:x/:y.png",
  ...pipeline({
    filters: false,
    cacheFor: null,
    tileParams: { maxZoom: MAX_ZOOM },
  }),
  async (req, res) => {
    const { layer, z, x, y } = req.params;

    const wmtsLayer = LAYERS[layer];
    if (!wmtsLayer) {
      return res.status(400).json({
        errors: [`unknown NONNA layer '${layer}'; expected 10 or 100`],
      });
    }

    const zoom = Number(z);
    const col = Number(x);
    const row = Number(y);

    const key = `${layer}/${zoom}/${col}/${row}`;
    const cached = cacheGet(key);
    if (cached) {
      return sendTile(res, cached, BROWSER_MAX_AGE_S);
    }

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
      // Not awaited: a slow redis must not hold up the response.
      redisSet(key, body);
      return sendTile(res, body, BROWSER_MAX_AGE_S);
    } catch (e) {
      // A 403 here means CHS changed the allowlist or the gateway rules.
      console.error(
        `NONNA tile ${key} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
      return sendTile(res, TRANSPARENT_PNG, ERROR_MAX_AGE_S);
    }
  },
);

module.exports = router;
