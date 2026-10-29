const express = require("express");
const axios = require("axios");
const { check } = require("express-validator");

const { pipeline } = require("../utils/routePipeline");
const { nonnaElevationAt } = require("../utils/nonnaWcs");
const { isWaterAt } = require("../utils/waterMask");

const router = express.Router();

// Global: answers wherever CHS has no sounding, e.g. offshore
// or zoomed out over EMODnet's basemap, whose own depth service stops at
// 70.5 W.
const GEBCO_OPENDAP =
  "https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/gebco_2026/ice_surface_elevation/netcdf/GEBCO_2026.nc";
const GEBCO_CELLS_PER_DEGREE = 240;
const GEBCO_ROWS = 180 * GEBCO_CELLS_PER_DEGREE;
const GEBCO_COLUMNS = 360 * GEBCO_CELLS_PER_DEGREE;
// 15 arc-seconds of latitude.
const GEBCO_RESOLUTION_M = 463;
const UPSTREAM_TIMEOUT_MS = 15000;

const gebcoIndex = (degrees, offset, cells) =>
  Math.min(cells - 1, Math.floor((degrees + offset) * GEBCO_CELLS_PER_DEGREE));

async function gebcoElevationAt(lon, lat) {
  const row = gebcoIndex(lat, 90, GEBCO_ROWS);
  const column = gebcoIndex(lon, 180, GEBCO_COLUMNS);
  const { data } = await axios.get(
    `${GEBCO_OPENDAP}.ascii?elevation[${row}][${column}]`,
    { responseType: "text", timeout: UPSTREAM_TIMEOUT_MS },
  );
  // OPeNDAP's ASCII grid: the value follows its "[0], " row index.
  const match = /\[0\],\s*(-?\d+)/.exec(data);
  const elevation = match ? Number(match[1]) : null;
  // Land, or a lake's surface: no seafloor to report.
  return elevation < 0 ? elevation : null;
}

const toDepth = (elevation) => Math.round(-elevation * 10) / 10;

/**
 * @swagger
 * /depth:
 *   get:
 *     summary: Seafloor depth at a point
 *     tags: [Basemap]
 *     description: >
 *       CHS NONNA 10 where it has a sounding (metres
 *       below chart datum), otherwise GEBCO 2026 at 15 arc-seconds
 *       (metres below mean sea level). A negative depth is NONNA ground
 *       that dries above the datum, inside OpenStreetMap's high-water line.
 *       Fields are null on land and where neither source has a value.
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
 *         description: '{ depth, resolution, source: "nonna" | "gebco" }'
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

    // CHS failing still leaves GEBCO's answer, which is better than none.
    let nonna = null;
    try {
      nonna = await nonnaElevationAt(lon, lat);
    } catch (e) {
      console.error(
        `NONNA depth at ${lon},${lat} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
    }
    // NONNA has cells on land too; the map hides them, so the probe does.
    if (nonna) {
      try {
        if (!(await isWaterAt(lon, lat))) nonna = null;
      } catch (e) {
        console.error(
          `Water mask at ${lon},${lat} failed:`,
          e.response ? `upstream ${e.response.status}` : e.message,
        );
      }
    }
    if (nonna) {
      return res.json({
        depth: toDepth(nonna.elevation),
        resolution: nonna.resolution,
        source: "nonna",
      });
    }

    try {
      const elevation = await gebcoElevationAt(lon, lat);
      return res.json(
        elevation === null
          ? { depth: null, resolution: null, source: null }
          : {
              depth: toDepth(elevation),
              resolution: GEBCO_RESOLUTION_M,
              source: "gebco",
            },
      );
    } catch (e) {
      console.error(
        `GEBCO depth at ${lon},${lat} failed:`,
        e.response ? `upstream ${e.response.status}` : e.message,
      );
      return res.status(502).json({ errors: ["depth lookup failed"] });
    }
  },
);

module.exports = router;
