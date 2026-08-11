require("dotenv").config();
const express = require("express");
const axios = require("axios");

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
 * Deliberately not utils/cache (apicache + redis) like the vector-tile routes.
 * That path stores values through an adapter that does
 * `typeof value === 'string' ? value : String(value)`, and String()-ing a
 * Buffer decodes it as UTF-8 — which mangles binary PNG bytes. A small bounded
 * in-process cache avoids the question entirely and is enough: it absorbs the
 * repeat requests a shared viewport generates, and the browser Cache-Control
 * above handles the rest.
 *
 * Sizing: measured tiles run ~5-40 KB, so the 3000 default is ~120 MB at the
 * absolute worst (every entry a dense 40 KB NONNA 10 tile) and more like 40-60
 * MB in practice. Both products are now requested across the same zoom range,
 * so a session pulls roughly twice the tiles it used to and the cache has to be
 * correspondingly bigger to still absorb a shared viewport. Override with
 * NONNA_TILE_CACHE_MAX where the container is memory-tight.
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
