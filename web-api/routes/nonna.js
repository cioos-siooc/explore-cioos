require("dotenv").config({ quiet: true });
const express = require("express");
const sharp = require("sharp");
const {
  createTileCache,
  sendTile,
  sendFallbackTile,
} = require("../utils/tileCache");
const { pipeline } = require("../utils/routePipeline");
const {
  COVERAGES,
  WEB_MERCATOR_HALF,
  fetchElevations,
  isSounding,
  wcsUrl,
} = require("../utils/nonnaWcs");

const router = express.Router();

/*
 * NONNA's gateway allowlists request origins exactly and 403s every other
 * Origin, including the CORS preflight. MapLibre always sends an Origin
 * (crossOrigin = 'anonymous', required for WebGL textures), while a
 * server-side request sends none and succeeds.
 *
 * Its WMTS tiles have CHS's colour ramp baked in and WMS refuses SLD_BODY, so
 * the raw float depths come from WCS instead (utils/nonnaWcs.js) and are
 * re-encoded as Terrarium DEM tiles: the browser colours (color-relief) and
 * shades (hillshade) them.
 */

const TILE_SIZE = 256;

const MAX_ZOOM = 21;

const BROWSER_MAX_AGE_S = 604800;

// Tiles run ~5-60 KB, so the 3000 default is ~180 MB at worst. CHS
// republishes NONNA on a slow cycle, so a month in redis is safe. Its own
// namespace so the old colour tiles in redis are never served as DEM.
const tileCache = createTileCache("nonna-dem", {
  l1Max:
    Number(process.env.NONNA_TILE_CACHE_MAX) > 0
      ? Number(process.env.NONNA_TILE_CACHE_MAX)
      : 3000,
  redisTtlS: 30 * 24 * 60 * 60,
});

function tileSubsets(z, x, y) {
  const size = (2 * WEB_MERCATOR_HALF) / 2 ** z;
  const minX = x * size - WEB_MERCATOR_HALF;
  const maxY = WEB_MERCATOR_HALF - y * size;
  return [`X(${minX},${minX + size})`, `Y(${maxY - size},${maxY})`];
}

// Terrarium: elevation = R*256 + G + B/256 - 32768. Nodata goes out as
// (0,0,0,0), which decodes to -32768, the bottom of color-relief's ramp.
function encodeTerrarium(elevations) {
  const rgba = Buffer.alloc(elevations.length * 4);
  elevations.forEach((v, i) => {
    if (!isSounding(v)) return;
    const shifted = v + 32768;
    rgba[i * 4] = Math.floor(shifted / 256);
    rgba[i * 4 + 1] = Math.floor(shifted) % 256;
    rgba[i * 4 + 2] = Math.floor((shifted % 1) * 256);
    rgba[i * 4 + 3] = 255;
  });
  return sharp(rgba, {
    raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 4 },
  })
    .png()
    .toBuffer();
}

const mergeLayers = (layers) =>
  layers[0].map(
    (_, i) => layers.map((layer) => layer[i]).find(isSounding) ?? NaN,
  );

const tileKey = (product, z, x, y) =>
  `${product === "fine" ? "10/" : ""}${z}/${x}/${y}`;

// NONNA 10 has one-pixel no-data rows and columns inside its own coverage,
// which the hillshade would draw as trenches and a NONNA 100 fill as steps;
// a gap pixel this close to soundings takes their mean instead.
const SEAM_FILL_PX = 3;

function fillSeams(layer) {
  return layer.map((v, i) => {
    if (isSounding(v)) return v;
    const row = Math.floor(i / TILE_SIZE);
    const col = i % TILE_SIZE;
    let sum = 0;
    let n = 0;
    for (
      let r = Math.max(0, row - SEAM_FILL_PX);
      r <= Math.min(TILE_SIZE - 1, row + SEAM_FILL_PX);
      r++
    ) {
      for (
        let c = Math.max(0, col - SEAM_FILL_PX);
        c <= Math.min(TILE_SIZE - 1, col + SEAM_FILL_PX);
        c++
      ) {
        const neighbour = layer[r * TILE_SIZE + c];
        if (isSounding(neighbour)) {
          sum += neighbour;
          n++;
        }
      }
    }
    return n ? sum / n : NaN;
  });
}

// Both products from one fetch: the colour and hillshade layers ask for the
// same tile, and this spares the second pair of WCS calls. The hillshade's
// leaves 100 m-only water unshaded.
async function renderTiles(z, x, y) {
  const subsets = tileSubsets(z, x, y);
  const coverages = COVERAGES.filter(({ minZoom }) => z >= minZoom);
  const [first, ...rest] = await Promise.all(
    coverages.map(({ id }) =>
      fetchElevations(
        wcsUrl(id, subsets, { scalesize: `i(${TILE_SIZE}),j(${TILE_SIZE})` }),
      ),
    ),
  );
  if (!rest.length) return { merged: await encodeTerrarium(first) };
  const fine = fillSeams(first);
  return {
    merged: await encodeTerrarium(mergeLayers([fine, ...rest])),
    fine: await encodeTerrarium(fine),
  };
}

function serveTile(product) {
  return async (req, res) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    const key = tileKey(product, z, x, y);
    const cached = await tileCache.get(key);
    if (cached) {
      return sendTile(res, cached, "image/png", BROWSER_MAX_AGE_S);
    }

    try {
      const tiles = await renderTiles(z, x, y);
      Object.entries(tiles).forEach(([name, body]) =>
        tileCache.set(tileKey(name, z, x, y), body),
      );
      // Below NONNA 10's zoom there is no fine tile; nothing shades there.
      if (!tiles[product]) return sendFallbackTile(res);
      return sendTile(res, tiles[product], "image/png", BROWSER_MAX_AGE_S);
    } catch (e) {
      // A 403 here means CHS changed the allowlist or the gateway rules.
      console.error(
        `NONNA tile ${key} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
      return sendFallbackTile(res);
    }
  };
}

const tilePipeline = pipeline({
  filters: false,
  cacheFor: null,
  tileParams: { maxZoom: MAX_ZOOM },
});

/**
 * @swagger
 * /nonna/{z}/{x}/{y}.png:
 *   get:
 *     summary: CHS NONNA bathymetry as a Terrarium-encoded DEM tile
 *     tags: [Nonna]
 *     description: >
 *       Fetches Canadian Hydrographic Service NONNA elevations from the CHS
 *       GeoServer WCS (NONNA 10 where it has soundings from zoom 11, NONNA 100
 *       elsewhere) and re-encodes them as a 256 px Terrarium PNG
 *       (elevation = R*256 + G + B/256 - 32768, metres, negative below chart
 *       datum). Pixels without soundings are fully transparent and decode to
 *       -32768.
 *     parameters:
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
 *         description: Terrarium PNG tile.
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Tile coordinates outside the zoom's grid.
 */
// No apicache: these routes run their own two-tier tile cache.
router.get("/:z/:x/:y.png", ...tilePipeline, serveTile("merged"));

/**
 * @swagger
 * /nonna/10/{z}/{x}/{y}.png:
 *   get:
 *     summary: CHS NONNA 10 alone as a Terrarium-encoded DEM tile
 *     tags: [Nonna]
 *     description: >
 *       As /nonna/{z}/{x}/{y}.png, but NONNA 10 only (its one-pixel no-data
 *       seams filled from the soundings around them). The source the map's hillshade reads from zoom 11;
 *       below it, a transparent tile.
 *     parameters:
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
 *         description: Terrarium PNG tile.
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Tile coordinates outside the zoom's grid.
 */
router.get("/10/:z/:x/:y.png", ...tilePipeline, serveTile("fine"));

module.exports = router;
