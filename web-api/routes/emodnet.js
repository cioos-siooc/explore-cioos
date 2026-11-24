const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const {
  createTileCache,
  sendTile,
  sendFallbackTile,
} = require("../utils/tileCache");
const { pipeline } = require("../utils/routePipeline");

const router = express.Router();

/*
 * EMODnet serves its bathymetry basemap as lossless RGBA PNGs (~120-150 KB a
 * tile) from a single European host with no CDN, which made it the slowest
 * layer on the map. Re-encoded once as opaque WebP they shrink 5-25x with no
 * visible change, and later requests skip the round trip to Europe.
 */

const EMODNET_BASELAYER = "https://tiles.emodnet-bathymetry.eu/2020/baselayer";
const EMODNET_TILES = `${EMODNET_BASELAYER}/web_mercator`;

// Web mercator stops at 85.05°N, so the globe's polar cap is drawn from the
// same base layer in IBCAO polar stereographic (frontend arcticCapLayer.js).
// Columns and rows 6-9 of this z4 grid enclose the cap; the frontend derives
// the image's extent from the same numbers.
const ARCTIC_TILES = `${EMODNET_BASELAYER}/epsg_3996`;
const ARCTIC_ZOOM = 4;
const ARCTIC_FIRST_TILE = 6;
const ARCTIC_TILE_SPAN = 4;
const TILE_PX = 256;

// The deepest level the basemap requests (basemapStyle.js's bathymetry source).
const MAX_ZOOM = 9;
const UPSTREAM_TIMEOUT_MS = 15000;
const WEBP_QUALITY = 85;

// The 2020 edition is frozen; a new one gets a new upstream URL.
const BROWSER_MAX_AGE_S = 30 * 24 * 60 * 60;

// WebP tiles run ~2-30 KB.
const tileCache = createTileCache("emodnet", {
  l1Max: 3000,
  redisTtlS: 30 * 24 * 60 * 60,
});

/**
 * @swagger
 * /emodnet/{z}/{x}/{y}.webp:
 *   get:
 *     summary: Proxy an EMODnet bathymetry basemap tile as WebP
 *     tags: [Basemap]
 *     description: >
 *       Fetches an EMODnet Bathymetry (2020) web-mercator basemap tile,
 *       re-encodes it as WebP and caches it. A transparent PNG is served on a
 *       short TTL when upstream fails.
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
 *         description: WebP tile (or a transparent PNG when upstream failed).
 *         content:
 *           image/webp:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Tile coordinates outside the zoom's grid.
 */
const toWebp = (input) =>
  sharp(input).removeAlpha().webp({ quality: WEBP_QUALITY }).toBuffer();

async function buildArcticCap() {
  const offsets = [...Array(ARCTIC_TILE_SPAN).keys()];
  const tiles = await Promise.all(
    offsets.flatMap((dy) =>
      offsets.map(async (dx) => {
        const x = ARCTIC_FIRST_TILE + dx;
        const y = ARCTIC_FIRST_TILE + dy;
        const upstream = await axios.get(
          `${ARCTIC_TILES}/${ARCTIC_ZOOM}/${x}/${y}.png`,
          { responseType: "arraybuffer", timeout: UPSTREAM_TIMEOUT_MS },
        );
        return {
          input: Buffer.from(upstream.data),
          left: dx * TILE_PX,
          top: dy * TILE_PX,
        };
      }),
    ),
  );
  const size = ARCTIC_TILE_SPAN * TILE_PX;
  const mosaic = await sharp({
    create: { width: size, height: size, channels: 3, background: "#000" },
  })
    .composite(tiles)
    .png()
    .toBuffer();
  return toWebp(mosaic);
}

/**
 * @swagger
 * /emodnet/arctic.webp:
 *   get:
 *     summary: EMODnet bathymetry for the Arctic cap past web mercator's reach
 *     tags: [Basemap]
 *     description: >
 *       A 1024 px mosaic of EMODnet Bathymetry World Base Layer tiles in IBCAO
 *       polar stereographic (EPSG:3996, z4, columns and rows 6-9), as WebP.
 *       The globe drapes it over the cap north of 85.05°N. A transparent PNG
 *       is served on a short TTL when upstream fails.
 *     responses:
 *       200:
 *         description: WebP mosaic (or a transparent PNG when upstream failed).
 *         content:
 *           image/webp:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get("/arctic.webp", async (req, res) => {
  const cached = await tileCache.get("arctic");
  if (cached) {
    return sendTile(res, cached, "image/webp", BROWSER_MAX_AGE_S);
  }
  try {
    const body = await buildArcticCap();
    tileCache.set("arctic", body);
    return sendTile(res, body, "image/webp", BROWSER_MAX_AGE_S);
  } catch (e) {
    console.error(
      "EMODnet Arctic cap failed:",
      e.response ? `upstream ${e.response.status}` : e.message,
    );
    return sendFallbackTile(res);
  }
});

// No apicache: tiles use their own two-tier cache.
router.get(
  "/:z/:x/:y.webp",
  ...pipeline({
    filters: false,
    cacheFor: null,
    tileParams: { maxZoom: MAX_ZOOM },
  }),
  async (req, res) => {
    const key = `${Number(req.params.z)}/${Number(req.params.x)}/${Number(req.params.y)}`;

    const cached = await tileCache.get(key);
    if (cached) {
      return sendTile(res, cached, "image/webp", BROWSER_MAX_AGE_S);
    }

    try {
      const upstream = await axios.get(`${EMODNET_TILES}/${key}.png`, {
        responseType: "arraybuffer",
        timeout: UPSTREAM_TIMEOUT_MS,
      });
      // The source is fully opaque, so the alpha channel is dead weight.
      const body = await toWebp(Buffer.from(upstream.data));
      tileCache.set(key, body);
      return sendTile(res, body, "image/webp", BROWSER_MAX_AGE_S);
    } catch (e) {
      console.error(
        `EMODnet tile ${key} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
      return sendFallbackTile(res);
    }
  },
);

module.exports = router;
