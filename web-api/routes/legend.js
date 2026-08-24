const express = require("express");

const router = express.Router();
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");

const createDBFilter = require("../utils/dbFilter");
const {
  parseMetric,
  recordCountExpr,
  countAggregate,
} = require("../utils/hexMetric");

// The ramp's domain, as [min, rampMax, trueMax], over a subquery whose bucket
// value is aliased `count`.
//
// rampMax is a high percentile rather than the true maximum, because record
// counts have a long and partly bogus tail. Measured on the full catalogue:
// hex counts run 1 .. 1.7e11, but the 99th percentile is 264k — the maximum is
// one mis-harvested fluorometer claiming 310 million records/day (its sibling
// CTD on the same deployment reports 2.8M). Ramping to the true max would put
// the median hex at 29% of a log ramp and hand the entire top half to a single
// bad dataset. Clamping saturates the top 1% at the darkest colour, which is
// what a reader expects of the darkest colour anyway.
//
// trueMax is carried so the legend can mark a clamped top tick with "+"
// instead of claiming a maximum that isn't the maximum.
const RAMP_MAX_PERCENTILE = 0.99;
function rampRange() {
  return `json_build_array(
    min(count),
    percentile_disc(${RAMP_MAX_PERCENTILE}) WITHIN GROUP (ORDER BY count),
    max(count)
  )`;
}

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
 *       - in: query
 *         name: metric
 *         description: >
 *           Which quantity the returned ranges are over. Must match the metric
 *           the tiles are requested with, or the colour ramp's domain won't
 *           match the numbers it is ramping.
 *         schema: { type: string, enum: [records, days, datasets], default: records }
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
 *                   description: >
 *                     Each tier is [min, rampMax, trueMax]. rampMax is the
 *                     99th percentile, not the maximum — record counts have a
 *                     long tail that would otherwise flatten the ramp; hexes
 *                     above it saturate at the darkest colour. trueMax lets
 *                     the legend mark a clamped top tick.
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
 *                 coverageCount:
 *                   type: object
 *                   description: >
 *                     Range for the always-hex coverage layer (trajectory +
 *                     OBIS cells together, one shared ramp). Only the hex_1
 *                     tier: below z7 these cells are folded into recordsCount
 *                     above, and the layer reuses hexes_zoom_1 past z6, so
 *                     there is no zoom0 or zoom2 bucket.
 *                   properties:
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
      // Rethrowing would reject the async handler, which Express 4 leaves
      // unhandled — that kills the process, not just this request.
      console.error(err);
      return res.status(500).json({ error: err.toString() });
    }
    const includeObis = req.query.includeObis !== 'false';
    // Must match the metric the tiles were requested with, or the ramp domain
    // won't match the numbers being ramped — see utils/hexMetric.js.
    const metric = parseMetric(req.query.metric);
    // Scientific-name filters are OBIS-only: hide profiles when set. An
    // OBIS-node selection also hides profiles, unless ERDDAP servers are
    // selected alongside it (combined Source filter — show both, OR'd in
    // the shared dataset filter).
    const includeProfiles = !req.query.scientificNames
      && (!req.query.obisNodes || Boolean(req.query.erddapServers));

    // GROUP BY the hex FK (integer) instead of the polygon geom; the polygon
    // lives on cde.hexes_zoom_0/1 and isn't needed here — only the summed
    // metric per bucket.
    // search_geom (bbox for profiles, cell point otherwise) backs the shared
    // spatial filter, matching tiles/shapeQuery. show_as_point gates profiles
    // out of every tier (hex and point) so the legend ranges match the tiles,
    // which keep large-region features off the map entirely.
    const profilesBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk, ${recordCountExpr('profiles', metric)},
               time_min, time_max, latitude, longitude, depth_min, depth_max, bbox AS search_geom
        FROM cde.profiles WHERE show_as_point AND :profileFilters`;
    // Trajectory and OBIS coverage cells merge into the hex-tier ranges
    // (zoom0/zoom1, the green ramp) but not the point-tier range (zoom2) — at
    // that zoom they only render via the dedicated always-hex coverage layer,
    // whose own range comes from the second query below.
    // cde.trajectory_hexes carries ONE hex per row plus its tier (each tier's
    // day count is aggregated independently), so the two hex FK columns the
    // other branches select are split out of hex_pk here. The NULL that leaves
    // in the other tier's column is why sub1/sub2 below exclude NULL keys —
    // otherwise every tier-1 row would pile into one bogus hex_0 bucket and
    // stretch the ramp domain.
    const trajectoryBranch = `SELECT CASE WHEN hex_tier = 0 THEN hex_pk END AS hex_0_pk,
               CASE WHEN hex_tier = 1 THEN hex_pk END AS hex_1_pk,
               NULL::integer AS point_pk, dataset_pk, ${recordCountExpr('trajectory_hexes', metric)},
               time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
        FROM cde.trajectory_hexes`;
    const obisBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk,
               ${recordCountExpr('obis_cells', metric)},
               time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
        FROM cde.obis_cells
        WHERE :obisFilters`;

    const hexBranches = [];
    if (includeProfiles) hexBranches.push(profilesBranch, trajectoryBranch);
    if (includeObis) hexBranches.push(obisBranch);
    // Empty-branch guard: profilesBranch carries its own WHERE (show_as_point),
    // so `${profilesBranch} WHERE FALSE` is a syntax error — wrap it in a
    // subquery, as the tile route does.
    const emptyBranch = `SELECT * FROM (${profilesBranch}) empty_branch WHERE FALSE`;
    const combinedHexInner = hexBranches.length
      ? hexBranches.join("\n        UNION ALL\n        ")
      : emptyBranch;

    // Only profiles reach the point tier: both cell tables are drawn as hexes
    // at every zoom, so counting them here would ramp the point circles
    // against data they don't contain.
    const combinedPointInner = includeProfiles ? profilesBranch : emptyBranch;

    const sql = `
        WITH combined_hex AS (
        ${combinedHexInner}
        ),
        combined_point AS (
        ${combinedPointInner}
        ),
        hex_records AS (
        SELECT hex_0_pk, hex_1_pk, point_pk, p.dataset_pk, record_count
        FROM combined_hex p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),
        point_records AS (
        SELECT point_pk, p.dataset_pk, record_count
        FROM combined_point p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),

        -- sum, not count(distinct point_pk): the ramp ranks hexes by how much
        -- data they hold, so its domain has to be over the same quantity the
        -- tiles emit as \`count\`.
        sub1 AS (SELECT ${rampRange()} zoom0 FROM (SELECT ${countAggregate(metric, 'hex_records')} count FROM hex_records WHERE hex_0_pk IS NOT NULL GROUP BY hex_0_pk) s),
        sub2 AS (SELECT ${rampRange()} zoom1 FROM (SELECT ${countAggregate(metric, 'hex_records')} count FROM hex_records WHERE hex_1_pk IS NOT NULL GROUP BY hex_1_pk) s),
        sub3 AS (SELECT ${rampRange()} zoom2 FROM (SELECT ${countAggregate(metric, 'point_records')} count FROM point_records GROUP BY point_pk) s)

        SELECT * from sub1,sub2,sub3
        `;

    // The always-hex coverage layer (trajectory + OBIS cells), which takes
    // over from the main hexes at z>=7. Both kinds now share one ramp, so
    // this is one domain over both — it used to be three separate ranges
    // feeding three separate colour scales (purple / amber / plum), which put
    // four colour families on screen at once at high zoom.
    //
    // Only the hex_1 tier is needed: below z7 these cells are folded into the
    // main hexes above, and the layer reuses hexes_zoom_1 uncapped past z6.
    //
    // Gating mirrors /tiles/cells. Note the frontend currently sends only the
    // filter query (which carries includeObis) to /legend, not the data-layer
    // toggles, so includeTrajectory defaults to on here — same as before this
    // change.
    const includeTrajectoryCells = req.query.includeTrajectory !== 'false'
      && includeProfiles;
    const coverageBranches = [];
    if (includeTrajectoryCells) {
      coverageBranches.push(`SELECT hex_pk AS hex_1_pk, dataset_pk, ${recordCountExpr('trajectory_hexes', metric)}
        FROM cde.trajectory_hexes WHERE hex_tier = 1`);
    }
    if (includeObis) {
      coverageBranches.push(`SELECT hex_1_pk, dataset_pk, ${recordCountExpr('obis_cells', metric)}
        FROM cde.obis_cells WHERE :obisFilters`);
    }
    const coverageInner = coverageBranches.length
      ? coverageBranches.join("\n        UNION ALL\n        ")
      : `SELECT hex_1_pk, dataset_pk, 0 as record_count FROM cde.obis_cells WHERE FALSE`;

    const coverageSql = `
        WITH cells AS (
        ${coverageInner}
        ),
        records AS (
        SELECT hex_1_pk, p.dataset_pk, record_count
        FROM cells p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),

        sub1 AS (SELECT ${rampRange()} zoom1 FROM (SELECT ${countAggregate(metric, 'records')} count FROM records GROUP BY hex_1_pk) s)

        SELECT * from sub1
        `;

    // Both aggregations scan the same large tables independently; run them
    // concurrently rather than back-to-back so legend latency is bounded by
    // the slower, not their sum. The legend gates first map paint, so this is
    // on the critical path.
    // Express 4 does not forward rejections from async handlers, so an
    // uncaught DB error here takes down the whole API process rather than
    // failing the one request. Contained the same way the tile routes do it.
    try {
      const [rows, coverageRows] = await Promise.all([
        db.raw(sql, {
          filters: filters.shared,
          obisFilters: filters.obisOnly,
          profileFilters: filters.profileOnly,
        }),
        db.raw(coverageSql, { filters: filters.shared, obisFilters: filters.obisOnly }),
      ]);

      res.send(rows && {
        recordsCount: rows.rows[0],
        coverageCount: coverageRows.rows[0],
      });
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
  },
);

module.exports = router;
