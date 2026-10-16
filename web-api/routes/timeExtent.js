const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

const createDBFilter = require("../utils/dbFilter");
const {
  erddapVisible,
  obisVisible,
  TRAJECTORY_COVERAGE_FROM,
  unionBranches,
} = require("../utils/selection");

/**
 * @swagger
 * /timeExtent:
 *   get:
 *     summary: Observation-time extent of the current selection
 *     tags: [Legend]
 *     description: >
 *       Earliest and latest observation time across the features matching the
 *       given filters. timeMin/timeMax are accepted but ignored — the extent is
 *       what bounds a time selection, so it cannot be bounded by one.
 *     parameters:
 *       - in: query
 *         name: latMin
 *         schema: { type: number }
 *       - in: query
 *         name: latMax
 *         schema: { type: number }
 *       - in: query
 *         name: lonMin
 *         schema: { type: number }
 *       - in: query
 *         name: lonMax
 *         schema: { type: number }
 *       - in: query
 *         name: depthMin
 *         schema: { type: number }
 *       - in: query
 *         name: depthMax
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: The extent. Both fields are null when nothing matches.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 min: { type: string, format: date-time, nullable: true }
 *                 max: { type: string, format: date-time, nullable: true }
 */
router.get("/", ...pipeline(), async (req, res) => {
  // The time filter is dropped: this drives the time slider's axis, which
  // would otherwise collapse towards its own handles on every drag.
  const { timeMin, timeMax, ...queryWithoutTime } = req.query;

  const filters = await createDBFilter(queryWithoutTime);

  const includeProfiles = erddapVisible(req.query);
  const includeObis = obisVisible(req.query);

  // Deliberately not restricted to show_as_point, unlike the tile and legend
  // routes: that flag decides whether a feature can be drawn, not whether it
  // is selected, and the dataset list and download include region-spanning
  // features too.
  const profilesBranch = `SELECT dataset_pk, point_pk, time_min, time_max,
               depth_min, depth_max, bbox AS search_geom
        FROM cde.profiles WHERE :profileFilters`;
  const trajectoryBranch = `SELECT t.dataset_pk, NULL::integer AS point_pk, t.time_min, t.time_max,
               t.depth_min, t.depth_max, h.geom AS search_geom
        ${TRAJECTORY_COVERAGE_FROM}`;
  const obisBranch = `SELECT dataset_pk, point_pk, time_min, time_max,
               depth_min, depth_max, geom AS search_geom
        FROM cde.obis_cells
        WHERE :obisFilters`;

  const branches = [];
  if (includeProfiles) branches.push(profilesBranch, trajectoryBranch);
  if (includeObis) branches.push(obisBranch);
  const inner = unionBranches(branches, profilesBranch);

  const sql = `
        WITH cells AS (
        ${inner}
        ),
        matched AS (
        SELECT p.time_min, p.time_max
        FROM cells p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        )
        SELECT min(time_min) AS min, max(time_max) AS max FROM matched
        `;

  const { rows } = await db.raw(sql, {
    filters: filters.shared,
    obisFilters: filters.obisOnly,
    profileFilters: filters.profileOnly,
  });
  res.send(rows[0] || { min: null, max: null });
});

module.exports = router;
