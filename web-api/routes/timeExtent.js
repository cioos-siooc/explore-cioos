const express = require("express");

const router = express.Router();
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");

const createDBFilter = require("../utils/dbFilter");

/*
 * /timeExtent
 *
 * The span of observation time the current selection actually covers:
 * min(time_min) .. max(time_max) over the same features the map and the
 * datasets list are built from.
 *
 * It drives the time slider's axis, which is why the time filter itself is
 * deliberately dropped from the query (see below) rather than honoured like
 * every other filter: an axis drawn from an extent that the axis's own handles
 * narrowed would collapse towards the handles on every drag.
 */

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
router.get(
  "/",
  cache.route(),
  validatorMiddleware(),
  async (req, res) => {
    // Everything except the time filter. Dropping it here rather than asking
    // the caller not to send it keeps share links (which carry timeMin/timeMax)
    // working without the frontend having to strip them.
    const { timeMin, timeMax, ...queryWithoutTime } = req.query;

    let filters;
    try {
      filters = await createDBFilter(queryWithoutTime);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      // Rethrowing would reject the async handler, which Express 4 leaves
      // unhandled — that kills the process, not just this request.
      console.error(err);
      return res.status(500).json({ error: err.toString() });
    }

    const includeObis = req.query.includeObis !== "false";
    // Scientific-name filters are OBIS-only: hide profiles when set. An
    // OBIS-node selection also hides profiles, unless ERDDAP servers are
    // selected alongside it. Same gating as /legend and /tiles, so the axis
    // spans the data those actually draw.
    const includeProfiles = !req.query.scientificNames
      && (!req.query.obisNodes || Boolean(req.query.erddapServers));

    // The column list is what the shared filter can reference (time, depth,
    // point_pk and search_geom); platform/organization_pks live on
    // cde.datasets and resolve through the join. EOVs are the exception:
    // cde.profiles carries its own per-feature list, so that predicate is
    // applied in the branch below rather than after the join.
    const profilesBranch = `SELECT dataset_pk, point_pk, time_min, time_max,
               depth_min, depth_max, bbox AS search_geom
        FROM cde.profiles WHERE show_as_point AND :profileFilters`;
    const trajectoryBranch = `SELECT dataset_pk, point_pk, time_min, time_max,
               depth_min, depth_max, geom AS search_geom
        FROM cde.trajectory_cells`;
    const obisBranch = `SELECT dataset_pk, point_pk, time_min, time_max,
               depth_min, depth_max, geom AS search_geom
        FROM cde.obis_cells
        WHERE :obisFilters`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch, trajectoryBranch);
    if (includeObis) branches.push(obisBranch);
    // profilesBranch carries its own WHERE, so `${profilesBranch} WHERE FALSE`
    // is a syntax error — wrap it, the way the tile and legend routes do.
    const inner = branches.length
      ? branches.join("\n        UNION ALL\n        ")
      : `SELECT * FROM (${profilesBranch}) empty_branch WHERE FALSE`;

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

    try {
      const { rows } = await db.raw(sql, {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        profileFilters: filters.profileOnly,
      });
      return res.send(rows[0] || { min: null, max: null });
    } catch (e) {
      console.error(e);
      return res.status(500).send({ error: e.toString() });
    }
  },
);

module.exports = router;
