const express = require("express");

const router = express.Router();
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");

const createDBFilter = require("../utils/dbFilter");

/*
 * /legend
 *
 * Get the range of counts for the hexes/points to set the color and legend text
 * in the front end
 *
 * Takes all the filters, returns a number range for each of the 3 major zoom levels
 */

/**
 * @swagger
 * /legend:
 *   get:
 *     summary: Get hex/point density ranges for legend
 *     tags: [Legend]
 *     description: Returns min/max counts for three zoom levels used to render the map legend.
 *     parameters:
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
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
 *         description: Legend count ranges.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recordsCount:
 *                   type: object
 *                   properties:
 *                     zoom0:
 *                       type: array
 *                       items: { type: integer }
 *                     zoom1:
 *                       type: array
 *                       items: { type: integer }
 *                     zoom2:
 *                       type: array
 *                       items: { type: integer }
 *                 trajectoryRecordsCount:
 *                   type: object
 *                   description: >
 *                     Distinct-trajectory count ranges per hex tier
 *                     (trajectories always render as hexes, so there's no
 *                     zoom2/point tier).
 *                   properties:
 *                     zoom0:
 *                       type: array
 *                       items: { type: integer }
 *                     zoom1:
 *                       type: array
 *                       items: { type: integer }
 */
router.get(
  "/",
  cache.route(),
  validatorMiddleware(),
  async (req, res, next) => {
    let filters;
    try {
      filters = await createDBFilter(req.query);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }
    const includeObis = req.query.includeObis !== 'false';
    // Scientific-name filters are OBIS-only: hide profiles when set. An
    // OBIS-node selection also hides profiles, unless ERDDAP servers are
    // selected alongside it (combined Source filter — show both, OR'd in
    // the shared dataset filter).
    const includeProfiles = !req.query.scientificNames
      && (!req.query.obisNodes || Boolean(req.query.erddapServers));

    // GROUP BY the hex FK (integer) instead of the polygon geom; the polygon
    // lives on cde.hexes_zoom_0/1 and isn't needed here — only distinct
    // point counts per bucket.
    const profilesBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk, days as record_count,
               time_min, time_max, latitude, longitude, depth_min, depth_max
        FROM cde.profiles`;
    // Trajectory coverage cells merge into the hex-tier ranges (zoom0/zoom1,
    // the green ramp) but not the point-tier range (zoom2) — at that zoom
    // they only render via the dedicated always-hex purple layer below.
    const trajectoryBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk, days as record_count,
               time_min, time_max, latitude, longitude, depth_min, depth_max
        FROM cde.trajectory_cells`;
    const obisBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk,
               date_part('days', time_max - time_min) + 1 as record_count,
               time_min, time_max, latitude, longitude, depth_min, depth_max
        FROM cde.obis_cells
        WHERE :obisFilters`;

    const hexBranches = [];
    if (includeProfiles) hexBranches.push(profilesBranch, trajectoryBranch);
    if (includeObis) hexBranches.push(obisBranch);
    const combinedHexInner = hexBranches.length
      ? hexBranches.join("\n        UNION ALL\n        ")
      : `${profilesBranch} WHERE FALSE`;

    const pointBranches = [];
    if (includeProfiles) pointBranches.push(profilesBranch);
    if (includeObis) pointBranches.push(obisBranch);
    const combinedPointInner = pointBranches.length
      ? pointBranches.join("\n        UNION ALL\n        ")
      : `${profilesBranch} WHERE FALSE`;

    const sql = `
        WITH combined_hex AS (
        ${combinedHexInner}
        ),
        combined_point AS (
        ${combinedPointInner}
        ),
        hex_records AS (
        SELECT hex_0_pk, hex_1_pk, point_pk
        FROM combined_hex p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),
        point_records AS (
        SELECT point_pk
        FROM combined_point p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),

        sub1 AS (SELECT json_build_array(min(count),max(count)) zoom0 FROM (SELECT count(distinct hex_records.point_pk) count FROM hex_records GROUP BY hex_0_pk) s),
        sub2 AS (SELECT json_build_array(min(count),max(count)) zoom1 FROM (SELECT count(distinct hex_records.point_pk) count FROM hex_records GROUP BY hex_1_pk) s),
        sub3 AS (SELECT json_build_array(min(count),max(count)) zoom2 FROM (SELECT count(distinct point_records.point_pk) count FROM point_records GROUP BY point_pk) s)

        SELECT * from sub1,sub2,sub3
        `;

    const rows = await db.raw(sql, { filters: filters.shared, obisFilters: filters.obisOnly });

    // Trajectory coverage cells always render as hexes (never points), so
    // they only need a hex_0/hex_1 range — no point-level zoom2 bucket.
    const trajectorySql = `
        WITH records AS (
        SELECT hex_0_pk, hex_1_pk, dataset_pk, trajectory_id
        FROM cde.trajectory_cells p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),

        sub1 AS (SELECT json_build_array(min(count),max(count)) zoom0 FROM (SELECT count(distinct (records.dataset_pk, records.trajectory_id)) count FROM records GROUP BY hex_0_pk) s),
        sub2 AS (SELECT json_build_array(min(count),max(count)) zoom1 FROM (SELECT count(distinct (records.dataset_pk, records.trajectory_id)) count FROM records GROUP BY hex_1_pk) s)

        SELECT * from sub1,sub2
        `;
    const trajectoryRows = await db.raw(trajectorySql, { filters: filters.shared });

    res.send(rows && {
      recordsCount: rows.rows[0],
      trajectoryRecordsCount: trajectoryRows.rows[0],
    });
  },
);

module.exports = router;
