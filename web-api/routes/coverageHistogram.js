const express = require("express");

const router = express.Router();
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");

const createDBFilter = require("../utils/dbFilter");

/*
 * /coverageHistogram
 *
 * A 1-D histogram of dataset counts over time, split into stacked series by a
 * chosen grouping dimension (data source / platform / data type). Takes the
 * same filters as /pointQuery — including the depth filter, which selects a
 * depth layer rather than being drawn as an axis.
 *
 * A dataset is counted in a time bin when any of its matched features' time
 * extent overlaps that bin. Features with no depth are treated as surface
 * (depth 0) so the depth filter still admits them.
 */

const DAY_MS = 86400000;
const YEAR_MS = 365.25 * DAY_MS;
// Candidate time-bin widths, day → quarter-century; the smallest width that
// keeps the bin count at or under the target is used, so the histogram stays
// readable at any zoom of the time filter.
const TIME_BIN_WIDTHS_MS = [
  DAY_MS, 2 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS,
  YEAR_MS / 12, YEAR_MS / 6, YEAR_MS / 4, YEAR_MS / 2,
  YEAR_MS, 2 * YEAR_MS, 5 * YEAR_MS, 10 * YEAR_MS, 25 * YEAR_MS,
];
const TARGET_TIME_BINS = 60;

// The grouping dimension → the SQL expression that yields each dataset's
// series key, plus the `kind` the frontend uses to resolve a display label.
// `d` is the cde.datasets alias in the query below.
const GROUP_BY = {
  source: {
    // OBIS datasets carry the https://obis.org sentinel erddap_url; their real
    // provenance is the OBIS node. ERDDAP datasets key on their server URL,
    // which the frontend maps to a friendly label via erddapServers.json.
    keyExpr: "CASE WHEN d.source_type = 'obis' "
      + "THEN coalesce(d.obis_nodes[1], 'OBIS') ELSE d.erddap_url END",
    kindExpr: "CASE WHEN d.source_type = 'obis' THEN 'obis' ELSE 'erddap' END",
  },
  platform: {
    keyExpr: "coalesce(nullif(d.platform, ''), 'unknown')",
    kindExpr: "'platform'",
  },
  dataType: {
    keyExpr: "coalesce(nullif(d.cdm_data_type, ''), 'unknown')",
    kindExpr: "'dataType'",
  },
};

function buildTimeBins(timeMin, timeMax) {
  // Same defaults as the frontend's time slider (config.js): the filter query
  // string omits them when untouched.
  const start = new Date(timeMin || "1900-01-01T00:00:00Z").getTime();
  let end = timeMax ? new Date(timeMax).getTime() : Date.now();
  if (end <= start) end = start + DAY_MS;

  const rawWidth = (end - start) / TARGET_TIME_BINS;
  const width = TIME_BIN_WIDTHS_MS.find((w) => w >= rawWidth)
    || TIME_BIN_WIDTHS_MS[TIME_BIN_WIDTHS_MS.length - 1];
  const numBins = Math.max(1, Math.ceil((end - start) / width));
  const edges = Array.from(
    { length: numBins + 1 },
    (_, i) => new Date(start + i * width).toISOString(),
  );
  return { edges, start, end: start + numBins * width, numBins };
}

/**
 * @swagger
 * /coverageHistogram:
 *   get:
 *     summary: Dataset counts over time, split by a grouping dimension
 *     tags: [CoverageHistogram]
 *     description: >
 *       Returns the number of distinct datasets whose filtered coverage
 *       overlaps each time bin, split into series by data source, platform, or
 *       data type. Accepts the same filter parameters as /pointQuery; the depth
 *       filter selects a depth layer. Features without depth count as surface.
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [source, platform, dataType] }
 *         description: Series dimension (default source).
 *       - in: query
 *         name: metric
 *         schema: { type: string, enum: [datasets, features] }
 *         description: >
 *           What each bar counts — distinct datasets (default) or distinct
 *           cf_role features (profiles / timeseries / trajectories). OBIS and
 *           griddap have no cf_role features and are absent from the features
 *           metric.
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: depthMin
 *         schema: { type: number }
 *       - in: query
 *         name: depthMax
 *         schema: { type: number }
 *       - in: query
 *         name: eovs
 *         schema: { type: string }
 *       - in: query
 *         name: platforms
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Binned, per-series dataset counts.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groupBy:
 *                   type: string
 *                 timeBinEdges:
 *                   type: array
 *                   items: { type: string, format: date-time }
 *                 series:
 *                   type: array
 *                   description: Series sorted by total dataset count, descending.
 *                   items:
 *                     type: object
 *                     properties:
 *                       key: { type: string }
 *                       kind: { type: string }
 *                       total: { type: integer }
 *                 cells:
 *                   type: array
 *                   description: "[timeBin (1-based), seriesKey, count] triples"
 *                   items:
 *                     type: array
 */
router.get(
  "/",
  cache.route(),
  validatorMiddleware(),
  async (req, res, next) => {
    const groupByKey = Object.prototype.hasOwnProperty.call(GROUP_BY, req.query.groupBy)
      ? req.query.groupBy
      : "source";
    const group = GROUP_BY[groupByKey];
    // What each bar counts: distinct datasets (default) or distinct cf_role
    // features (individual profiles / timeseries / trajectories).
    const metric = req.query.metric === "features" ? "features" : "datasets";

    let filters;
    try {
      filters = await createDBFilter(req.query);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    const {
      timeMin, timeMax, includeObis, scientificNames, obisNodes, erddapServers,
    } = req.query;

    // Same source gating as shapeQuery: scientific-name filters are OBIS-only;
    // an OBIS-node selection hides profiles unless ERDDAP servers are selected
    // alongside it.
    const includeProfiles = !scientificNames && (!obisNodes || Boolean(erddapServers));
    const showObis = includeObis !== "false";

    const timeBins = buildTimeBins(timeMin, timeMax);

    // Depth NULLs coalesce to 0 so the shared depth filter treats depth-less
    // features as surface. Only the columns the filter and binning need are
    // selected; depth is not an output dimension here.
    // feature_key identifies one cf_role instance for the "features" metric:
    // a profile/timeseries cast (profiles) or a trajectory (trajectory_cells).
    // OBIS occurrences and griddap grids have no cf_role, so their key is NULL
    // and they drop out of the features count entirely.
    const profilesBranch = `SELECT dataset_pk, time_min, time_max,
               coalesce(depth_min, 0) AS depth_min,
               coalesce(depth_max, depth_min, 0) AS depth_max,
               dataset_pk::text || ':p:' || coalesce(timeseries_id, '')
                 || '|' || coalesce(profile_id, '') AS feature_key,
               bbox AS search_geom
        FROM cde.profiles`;
    const trajectoryBranch = `SELECT dataset_pk, time_min, time_max,
               coalesce(depth_min, 0) AS depth_min,
               coalesce(depth_max, depth_min, 0) AS depth_max,
               dataset_pk::text || ':t:' || coalesce(trajectory_id, '') AS feature_key,
               geom AS search_geom
        FROM cde.trajectory_cells`;
    const obisBranch = `SELECT dataset_pk, time_min, time_max,
               coalesce(depth_min, 0) AS depth_min,
               coalesce(depth_max, depth_min, 0) AS depth_max,
               NULL::text AS feature_key,
               geom AS search_geom
        FROM cde.obis_cells
        WHERE :obisFilters`;
    const griddapBranch = `SELECT pk AS dataset_pk,
               coalesce(coverage_time_min, '-infinity'::timestamptz) AS time_min,
               coalesce(coverage_time_max, 'infinity'::timestamptz) AS time_max,
               coalesce(coverage_depth_min, 0) AS depth_min,
               coalesce(coverage_depth_max, coverage_depth_min, 0) AS depth_max,
               NULL::text AS feature_key,
               coverage_bbox AS search_geom
        FROM cde.datasets
        WHERE cdm_data_type = 'Grid' AND coverage_bbox IS NOT NULL`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch, trajectoryBranch, griddapBranch);
    if (showObis) branches.push(obisBranch);
    const combinedInner = branches.length
      ? branches.join("\n        UNION ALL\n        ")
      : `${profilesBranch} WHERE FALSE`;

    // `filtered` also derives each row's series key/kind from the joined
    // dataset. Shared by both queries below; declared as a string so the scan
    // definition stays identical between them. NOTE: knex substitutes named
    // bindings even inside SQL comments, so never write a colon-prefixed word
    // in comments here.
    const combinedAndFiltered = `combined AS (
        ${combinedInner}
    ),
    filtered AS (
        SELECT p.dataset_pk, p.feature_key, p.time_min, p.time_max,
               ${group.keyExpr} AS series_key,
               ${group.kindExpr} AS series_kind
        FROM   combined p
        JOIN   cde.datasets d
        ON     p.dataset_pk = d.pk
        WHERE  ${filters.hasShared ? ":filters" : "TRUE"}
        AND    p.time_max >= :timeStart::timestamptz
        AND    p.time_min <= :timeEnd::timestamptz
        ${metric === "features" ? "AND p.feature_key IS NOT NULL" : ""}
    )`;

    // The counted entity: distinct datasets, or distinct cf_role features.
    const entityCol = metric === "features" ? "feature_key" : "dataset_pk";

    // Cells: bucket each feature's time extent into a 1-based bin-index range,
    // collapse to DISTINCT (dataset, series, tb0, tb1) tuples first (buckets
    // are coarse, so a dataset's features mostly share a tuple), then expand
    // into the bins each tuple spans and count distinct datasets per
    // (bin, series).
    const cellsSql = `WITH ${combinedAndFiltered},
    bucketed AS (
        SELECT DISTINCT ${entityCol} AS entity, series_key,
            least(greatest(width_bucket(
                extract(epoch from greatest(time_min, :timeStart::timestamptz))::double precision,
                (:epochStart)::double precision, (:epochEnd)::double precision, (:numTimeBins)::integer
            ), 1), (:numTimeBins)::integer) AS tb0,
            least(greatest(width_bucket(
                extract(epoch from least(time_max, :timeEnd::timestamptz))::double precision,
                (:epochStart)::double precision, (:epochEnd)::double precision, (:numTimeBins)::integer
            ), 1), (:numTimeBins)::integer) AS tb1
        FROM filtered
    ),
    expanded AS (
        SELECT DISTINCT entity, series_key, t.t
        FROM bucketed
        CROSS JOIN LATERAL generate_series(tb0, tb1) AS t(t)
    )
    SELECT t, series_key, count(*)::integer AS count
    FROM expanded
    GROUP BY t, series_key`;

    // Series totals: distinct datasets per series over the whole filtered set
    // (not the sum of per-bin counts, which would multiply a long-lived
    // dataset across its bins). Used to rank series and pick the top ones.
    const seriesSql = `WITH ${combinedAndFiltered}
    SELECT series_key, min(series_kind) AS series_kind,
           count(DISTINCT ${entityCol})::integer AS total
    FROM filtered
    GROUP BY series_key
    ORDER BY total DESC`;

    const bindings = {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      timeStart: new Date(timeBins.start).toISOString(),
      timeEnd: new Date(timeBins.end).toISOString(),
      epochStart: timeBins.start / 1000,
      epochEnd: timeBins.end / 1000,
      numTimeBins: timeBins.numBins,
    };

    // Both scan the same tables independently; run concurrently so latency is
    // bounded by the slower, not their sum (as /legend does).
    const [cellRows, seriesRows] = await Promise.all([
      db.raw(cellsSql, bindings),
      db.raw(seriesSql, bindings),
    ]);

    res.send({
      groupBy: groupByKey,
      metric,
      timeBinEdges: timeBins.edges,
      series: seriesRows.rows.map((r) => ({
        key: r.series_key,
        kind: r.series_kind,
        total: r.total,
      })),
      cells: cellRows.rows.map((r) => [r.t, r.series_key, r.count]),
    });
  },
);

module.exports = router;
