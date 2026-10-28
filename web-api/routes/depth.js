const express = require("express");
const axios = require("axios");
const { check } = require("express-validator");

const { pipeline } = require("../utils/routePipeline");
const { nonnaElevationAt } = require("../utils/nonnaWcs");

const router = express.Router();

// Global, land included: answers wherever CHS has no sounding, e.g. offshore
// or zoomed out over EMODnet's basemap, whose own depth service stops at
// 70.5 W.
const ETOPO_GRIDDAP =
  "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.json";
// 15 arc-seconds of latitude.
const ETOPO_RESOLUTION_M = 450;
const UPSTREAM_TIMEOUT_MS = 15000;

async function etopoElevationAt(lon, lat) {
  const query = encodeURIComponent(`z[(${lat})][(${lon})]`);
  const { data } = await axios.get(`${ETOPO_GRIDDAP}?${query}`, {
    timeout: UPSTREAM_TIMEOUT_MS,
  });
  const [row] = data.table.rows;
  return Number.isFinite(row?.[2]) ? row[2] : null;
}

const toDepth = (elevation) => Math.round(-elevation * 10) / 10;

/**
 * @swagger
 * /depth:
 *   get:
 *     summary: Seafloor depth, or land elevation, at a point
 *     tags: [Basemap]
 *     description: >
 *       CHS NONNA 10 where it has a sounding (metres
 *       below chart datum), otherwise NOAA ETOPO 2022 at 15 arc-seconds
 *       (metres below mean sea level). depth is negative above the datum:
 *       ground that dries, or land. Fields are null when neither source has a
 *       value.
 *     parameters:
 *       - in: query
 *         name: lon
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -85, maximum: 85 }
 *     responses:
 *       200:
 *         description: '{ depth, resolution, source: "nonna" | "etopo" }'
 *       400:
 *         description: Missing or out-of-range coordinates.
 *       502:
 *         description: Neither source answered.
 */
router.get(
  "/",
  ...pipeline({
    filters: false,
    checks: [
      check("lon").isFloat({ min: -180, max: 180 }),
      // Web Mercator's own limit.
      check("lat").isFloat({ min: -85, max: 85 }),
    ],
  }),
  async (req, res) => {
    const lon = Number(req.query.lon);
    const lat = Number(req.query.lat);

    // CHS failing still leaves ETOPO's answer, which is better than none.
    let nonna = null;
    try {
      nonna = await nonnaElevationAt(lon, lat);
    } catch (e) {
      console.error(
        `NONNA depth at ${lon},${lat} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
    }
    if (nonna) {
      return res.json({
        depth: toDepth(nonna.elevation),
        resolution: nonna.resolution,
        source: "nonna",
      });
    }

    try {
      const elevation = await etopoElevationAt(lon, lat);
      return res.json(
        elevation === null
          ? { depth: null, resolution: null, source: null }
          : {
              depth: toDepth(elevation),
              resolution: ETOPO_RESOLUTION_M,
              source: "etopo",
            },
      );
    } catch (e) {
      console.error(
        `ETOPO depth at ${lon},${lat} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
      return res.status(502).json({ errors: ["depth lookup failed"] });
    }
  },
);

module.exports = router;
