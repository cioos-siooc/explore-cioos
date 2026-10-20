require("dotenv").config({ quiet: true });
const express = require("express");
const axios = require("axios");
const {
  createTileCache,
  sendTile,
  sendFallbackTile,
} = require("../utils/tileCache");
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

const BROWSER_MAX_AGE_S = 604800;

// Tiles run ~5-40 KB, so the 3000 default is ~120 MB at worst. CHS
// republishes NONNA on a slow cycle, so a month in redis is safe.
const tileCache = createTileCache("nonna", {
  l1Max:
    Number(process.env.NONNA_TILE_CACHE_MAX) > 0
      ? Number(process.env.NONNA_TILE_CACHE_MAX)
      : 3000,
  redisTtlS: 30 * 24 * 60 * 60,
});

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
    const cached = await tileCache.get(key);
    if (cached) {
      return sendTile(res, cached, "image/png", BROWSER_MAX_AGE_S);
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
      tileCache.set(key, body);
      return sendTile(res, body, "image/png", BROWSER_MAX_AGE_S);
    } catch (e) {
      // A 403 here means CHS changed the allowlist or the gateway rules.
      console.error(
        `NONNA tile ${key} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
      return sendFallbackTile(res);
    }
  },
);

module.exports = router;
