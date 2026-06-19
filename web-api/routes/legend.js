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
    // Scientific-name and OBIS-node filters are OBIS-only: when either is
    // set, hide profiles and narrow to OBIS rows.
    const includeProfiles = !req.query.scientificNames && !req.query.obisNodes;

    // GROUP BY the hex FK (integer) instead of the polygon geom; the polygon
    // lives on cde.hexes_zoom_0/1 and isn't needed here — only distinct
    // point counts per bucket.
    const profilesBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk, days as record_count,
               time_min, time_max, latitude, longitude, depth_min, depth_max
        FROM cde.profiles`;
    const obisBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk,
               date_part('days', time_max - time_min) + 1 as record_count,
               time_min, time_max, latitude, longitude, depth_min, depth_max
        FROM cde.obis_cells
        WHERE :obisFilters`;
    // Trajectory coverage contributes to the hex density buckets (zoom0/zoom1)
    // just like profiles/obis. point_pk is negated so a track counts once per
    // hex without colliding with point point_pks.
    const trajectoryBranch = `SELECT th.hex_0_pk, th.hex_1_pk, (-t.pk) as point_pk, th.dataset_pk,
               t.days as record_count,
               t.time_min, t.time_max,
               NULL::double precision as latitude, NULL::double precision as longitude,
               t.depth_min, t.depth_max
        FROM cde.trajectory_hexes th
        JOIN cde.trajectories t ON t.pk = th.trajectory_pk`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch);
    if (includeObis) branches.push(obisBranch);
    // Trajectories follow the same (non-OBIS) gate as profiles.
    if (includeProfiles) branches.push(trajectoryBranch);
    const combinedInner = branches.length
      ? branches.join("\n        UNION ALL\n        ")
      : `${profilesBranch} WHERE FALSE`;

    const sql = `
        WITH combined AS (
        ${combinedInner}
        ),
        records AS (
        SELECT hex_0_pk, hex_1_pk, point_pk, record_count as days
        FROM combined p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),

        sub1 AS (SELECT json_build_array(min(count),max(count)) zoom0 FROM (SELECT count(distinct records.point_pk) count FROM records GROUP BY hex_0_pk) s),
        sub2 AS (SELECT json_build_array(min(count),max(count)) zoom1 FROM (SELECT count(distinct records.point_pk) count FROM records GROUP BY hex_1_pk) s),
        sub3 AS (SELECT json_build_array(min(count),max(count)) zoom2 FROM (SELECT count(distinct records.point_pk) count FROM records GROUP BY point_pk) s)

        SELECT * from sub1,sub2,sub3
        `;

    const rows = await db.raw(sql, { filters: filters.shared, obisFilters: filters.obisOnly });

    res.send(rows && { recordsCount: rows.rows[0] });
  },
);

module.exports = router;
