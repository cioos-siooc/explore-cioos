const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

const createDBFilter = require("../utils/dbFilter");
const {
  parseMetric,
  metricValueExpr,
  metricJoin,
  countAggregate,
} = require("../utils/hexMetric");
const { FINE } = require("../utils/hexTiers");
const {
  erddapVisible,
  obisVisible,
  DRAWN_AS_POINT,
  coarseRollupBranch,
  unionBranches,
} = require("../utils/selection");

// [min, rampMax, trueMax]. rampMax is a percentile because record counts have
// a long, partly bogus tail: hex counts run to 1.7e11 while the 99th
// percentile is 264k, so ramping to the true max would hand the top half of
// the ramp to one mis-harvested dataset. trueMax lets the legend mark a
// clamped top tick with "+".
const RAMP_MAX_PERCENTILE = 0.99;
function rampRange() {
  return `json_build_array(
    min(count),
    percentile_disc(${RAMP_MAX_PERCENTILE}) WITHIN GROUP (ORDER BY count),
    max(count)
  )`;
}

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
router.get("/", ...pipeline(), async (req, res) => {
  const filters = await createDBFilter(req.query);
  // Must match the metric the tiles were requested with, or the ramp domain
  // won't match the numbers being ramped.
  const metric = parseMetric(req.query.metric);
  const includeObis = obisVisible(req.query);
  const includeProfiles = erddapVisible(req.query);

  // DRAWN_AS_POINT gates profiles out of every tier so the ranges match the
  // tiles, which keep large-region features off the map entirely.
  const profilesBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk, ${metricValueExpr("profiles", metric)},
               time_min, time_max, latitude, longitude, depth_min, depth_max, bbox AS search_geom
        FROM cde.profiles ${metricJoin("profiles", metric)}
        WHERE ${DRAWN_AS_POINT} AND :profileFilters`;
  // cde.trajectory_hexes carries one hex per row plus its tier, so the other
  // tier's column is NULL; that is why sub1/sub2 below exclude NULL keys, or
  // every tier-1 row would pile into one bogus hex_0 bucket.
  const trajectoryBranch = `SELECT CASE WHEN hex_tier = 0 THEN hex_pk END AS hex_0_pk,
               CASE WHEN hex_tier = 1 THEN hex_pk END AS hex_1_pk,
               NULL::integer AS point_pk, dataset_pk, ${metricValueExpr("trajectory_hexes", metric)},
               time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
        FROM cde.trajectory_hexes ${metricJoin("trajectory_hexes", metric)}`;
  const obisBranch = `SELECT hex_0_pk, hex_1_pk, point_pk, dataset_pk,
               ${metricValueExpr("obis_cells", metric)},
               time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
        FROM cde.obis_cells ${metricJoin("obis_cells", metric)}
        WHERE :obisFilters`;

  const hexBranches = [];
  if (includeProfiles) hexBranches.push(profilesBranch, trajectoryBranch);
  if (includeObis) hexBranches.push(obisBranch);
  const combinedHexInner = unionBranches(hexBranches, profilesBranch);

  // Only profiles reach the point tier: both cell tables are drawn as hexes
  // at every zoom.
  const combinedPointInner = unionBranches(
    includeProfiles ? [profilesBranch] : [],
    profilesBranch,
  );

  const zoom0FromRollup = filters.datasetLevelOnly;
  const rollupConds = [];
  if (includeProfiles) {
    rollupConds.push("source = 'profiles'", "source = 'trajectory'");
  }
  if (includeObis) rollupConds.push("source = 'obis'");
  const zoom0Records = zoom0FromRollup
    ? `rollup_records AS (
        SELECT hex_0_pk, p.dataset_pk, metric_value
        FROM (${coarseRollupBranch(metric, rollupConds, "hex_0_pk")}) p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),`
    : "";
  const zoom0Source = zoom0FromRollup ? "rollup_records" : "hex_records";

  const sql = `
        WITH combined_hex AS (
        ${combinedHexInner}
        ),
        combined_point AS (
        ${combinedPointInner}
        ),
        hex_records AS (
        SELECT hex_0_pk, hex_1_pk, point_pk, p.dataset_pk, metric_value
        FROM combined_hex p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),
        point_records AS (
        SELECT point_pk, p.dataset_pk, metric_value
        FROM combined_point p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),
        ${zoom0Records}

        -- Aggregated exactly as the tiles aggregate \`count\`, or the domain
        -- won't match what is ramped.
        sub1 AS (SELECT ${rampRange()} zoom0 FROM (SELECT ${countAggregate(metric, zoom0Source)} count FROM ${zoom0Source} WHERE hex_0_pk IS NOT NULL GROUP BY hex_0_pk) s),
        sub2 AS (SELECT ${rampRange()} zoom1 FROM (SELECT ${countAggregate(metric, "hex_records")} count FROM hex_records WHERE hex_1_pk IS NOT NULL GROUP BY hex_1_pk) s),
        sub3 AS (SELECT ${rampRange()} zoom2 FROM (SELECT ${countAggregate(metric, "point_records")} count FROM point_records GROUP BY point_pk) s)

        SELECT * from sub1,sub2,sub3
        `;

  // Coverage layer: only the hex_1 tier is needed, since below z7 these cells
  // fold into the main hexes and the layer reuses hexes_zoom_1 past z6.
  //
  // The frontend sends only the filter query to /legend, not the data-layer
  // toggles, so includeTrajectory defaults to on here.
  const includeTrajectoryCells =
    req.query.includeTrajectory !== "false" && includeProfiles;
  // dbFilter emits unqualified time_min/depth_min/... predicates, so every
  // branch must carry those columns or the statement fails to parse.
  const trajectoryCoverageBranch = `SELECT hex_pk AS hex_1_pk, dataset_pk, ${metricValueExpr("trajectory_hexes", metric)},
        time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
        FROM cde.trajectory_hexes ${metricJoin("trajectory_hexes", metric)}
        WHERE hex_tier = ${FINE.tier}`;
  const obisCoverageBranch = `SELECT hex_1_pk, dataset_pk, ${metricValueExpr("obis_cells", metric)},
        time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
        FROM cde.obis_cells ${metricJoin("obis_cells", metric)}
        WHERE :obisFilters`;

  const coverageBranches = [];
  if (includeTrajectoryCells) coverageBranches.push(trajectoryCoverageBranch);
  if (includeObis) coverageBranches.push(obisCoverageBranch);
  // The empty case wraps a real branch rather than a typed NULL shell because
  // metric_value's type depends on the metric.
  const coverageInner = unionBranches(coverageBranches, obisCoverageBranch);

  const coverageSql = `
        WITH cells AS (
        ${coverageInner}
        ),
        records AS (
        SELECT hex_1_pk, p.dataset_pk, metric_value
        FROM cells p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        ),

        sub1 AS (SELECT ${rampRange()} zoom1 FROM (SELECT ${countAggregate(metric, "records")} count FROM records GROUP BY hex_1_pk) s)

        SELECT * from sub1
        `;

  // Concurrent because the legend gates first map paint.
  const [rows, coverageRows] = await Promise.all([
    db.raw(sql, {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
    }),
    db.raw(coverageSql, {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
    }),
  ]);

  res.send(
    rows && {
      recordsCount: rows.rows[0],
      coverageCount: coverageRows.rows[0],
    },
  );
});

module.exports = router;
