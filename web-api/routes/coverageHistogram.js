const express = require("express");

const router = express.Router();
const db = require("../db");
const { check } = require("express-validator");
const { pipeline } = require("../utils/routePipeline");

const createDBFilter = require("../utils/dbFilter");
const {
  erddapVisible,
  obisVisible,
  TRAJECTORY_COVERAGE_FROM,
  GRIDDAP_TIME_DEPTH_COLUMNS,
  GRIDDAP_FROM,
  unionBranches,
} = require("../utils/selection");

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
  DAY_MS,
  2 * DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  YEAR_MS / 12,
  YEAR_MS / 6,
  YEAR_MS / 4,
  YEAR_MS / 2,
  YEAR_MS,
  2 * YEAR_MS,
  5 * YEAR_MS,
  10 * YEAR_MS,
  25 * YEAR_MS,
];
const TARGET_TIME_BINS = 60;

// What each bar counts. Deliberately NOT the `metric` query parameter: that
// name belongs to the hex ramp (utils/hexMetric.js METRICS = records/days/
// datasets), which the shared filter validators check strictly. Overloading it
// here meant "datasets" validated by coincidence and "features" was rejected
// outright — the default worked, so only picking Features in the UI broke.
const COUNTS = ["datasets", "features", "days"];

// The grouping dimension → the SQL expression that yields each dataset's
// series key, plus the `kind` the frontend uses to resolve a display label.
// `d` is the cde.datasets alias in the query below.
const GROUP_BY = {
  source: {
    // OBIS datasets carry the https://obis.org sentinel erddap_url; their real
    // provenance is the OBIS node. ERDDAP datasets key on their server URL,
    // which the frontend maps to a friendly label via erddapServers.json.
    keyExpr:
      "CASE WHEN d.source_type = 'obis' " +
      "THEN coalesce(d.obis_nodes[1], 'OBIS') ELSE d.erddap_url END",
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
  // The only multi-valued dimension: cde.datasets.organizations is a text[]
  // and a dataset can belong to several, so this one needs a lateral to
  // produce a row per (dataset, organization). A dataset with N organizations
  // therefore lands in N series and the stacked bars sum ABOVE the dataset
  // count — each series still reads correctly on its own as "datasets this
  // organization has here", which is the same thing the organizations filter
  // means (dbFilter matches on array overlap, not on a single owner).
  organization: {
    join:
      "CROSS JOIN LATERAL unnest(CASE WHEN coalesce(array_length(d.organizations, 1), 0) = 0 " +
      "THEN ARRAY['unknown']::text[] ELSE d.organizations END) AS org(name)",
    keyExpr: "org.name",
    kindExpr: "'organization'",
  },
};

function buildTimeBins(timeMin, timeMax) {
  // Same defaults as the frontend's time slider (config.js): the filter query
  // string omits them when untouched.
  const start = new Date(timeMin || "1900-01-01T00:00:00Z").getTime();
  let end = timeMax ? new Date(timeMax).getTime() : Date.now();
  if (end <= start) end = start + DAY_MS;

  const rawWidth = (end - start) / TARGET_TIME_BINS;
  const width =
    TIME_BIN_WIDTHS_MS.find((w) => w >= rawWidth) ||
    TIME_BIN_WIDTHS_MS[TIME_BIN_WIDTHS_MS.length - 1];
  const numBins = Math.max(1, Math.ceil((end - start) / width));
  const edges = Array.from({ length: numBins + 1 }, (_, i) =>
    new Date(start + i * width).toISOString(),
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
 *       overlaps each time bin, split into series by data source, platform, data
 *       type, or organization. Accepts the same filter parameters as /pointQuery; the depth
 *       filter selects a depth layer. Features without depth count as surface.
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [source, platform, dataType, organization] }
 *         description: Series dimension (default source).
 *       - in: query
 *         name: count
 *         schema: { type: string, enum: [datasets, features, days] }
 *         description: >
 *           What each bar counts — distinct datasets (default), distinct
 *           cf_role features (profiles / timeseries / trajectories), or days
 *           of data. OBIS and griddap have no cf_role features and are absent
 *           from the features count. `days` sums each feature's own days
 *           within the bin across features, so two moorings recording the same
 *           90 days contribute 180: it measures observation effort and can
 *           exceed the number of calendar days in the bin. That is deliberately
 *           unlike the map's `days` ramp, which unions them.
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
  ...pipeline({ checks: [check("count").isIn(COUNTS).optional()] }),
  async (req, res) => {
    const groupByKey = Object.prototype.hasOwnProperty.call(
      GROUP_BY,
      req.query.groupBy,
    )
      ? req.query.groupBy
      : "source";
    const group = GROUP_BY[groupByKey];
    // What each bar counts: distinct datasets (default) or distinct cf_role
    // features (individual profiles / timeseries / trajectories).
    const count = COUNTS.includes(req.query.count)
      ? req.query.count
      : "datasets";

    // Client errors (a bad polygon, too broad a taxon selection) carry a
    // statusCode that app.js's error handler turns into the response.
    const filters = await createDBFilter(req.query);

    const { timeMin, timeMax } = req.query;

    // Which sources this selection contains. utils/selection.js owns that gate
    // for every route that answers a question about a selection off the map;
    // this used to be a fourth hand-written copy of it, which is how the
    // trajectory branch here went on reading cde.trajectory_cells for weeks
    // after that table was replaced.
    const erddap = erddapVisible(req.query);
    const obis = obisVisible(req.query);

    const timeBins = buildTimeBins(timeMin, timeMax);

    // The counted entity: distinct datasets, or distinct cf_role features.
    // What one counted thing is. For "days" the unit is the FEATURE, falling
    // back to the dataset where there is no cf_role: a trajectory is stored as
    // one row per hex, so its days have to be unioned up to the trajectory
    // before they are added to anything, or a ship crossing fifty hexes in a
    // day contributes fifty days. Same for OBIS cells. feature_key always
    // contains a colon, so it can never collide with a bare dataset pk.
    const entityExpr =
      count === "features"
        ? "p.feature_key"
        : count === "days"
          ? "coalesce(p.feature_key, p.dataset_pk::text)"
          : "p.dataset_pk::text";

    // Depth NULLs coalesce to 0 so the shared depth filter treats depth-less
    // features as surface. Only the columns the filter, the grouping and the
    // binning need are selected; depth is not an output dimension here.
    //
    // point_pk is carried for the same reason the shape query carries it: a
    // map-click selection puts an UNQUALIFIED point_pk predicate in the shared
    // filter, and a branch missing the name makes the whole statement fail to
    // parse. Grids and trajectory hexes have no point, so they spell it NULL.
    //
    // day_ranges rides along on every branch: the bins are built from the real
    // observation-day set wherever it is known (see the spans CTE below).
    //
    // feature_key identifies one cf_role instance for the "features" count:
    // a profile/timeseries cast, or a trajectory. OBIS occurrences and griddap
    // grids have no cf_role, so their key is NULL and they drop out of that
    // count entirely.
    const profilesBranch = `SELECT dataset_pk, time_min, time_max,
               coalesce(depth_min, 0) AS depth_min,
               coalesce(depth_max, depth_min, 0) AS depth_max,
               dataset_pk::text || ':p:' || coalesce(timeseries_id, '')
                 || '|' || coalesce(profile_id, '') AS feature_key,
               point_pk, bbox AS search_geom, day_ranges
        FROM cde.profiles
        WHERE :profileFilters`;
    // One tier only, matching against the hex POLYGON rather than the row's
    // centroid — see utils/selection.js. Reading both tiers would count each
    // trajectory twice; only the distinct-count downstream hid that before.
    const trajectoryBranch = `SELECT t.dataset_pk, t.time_min, t.time_max,
               coalesce(t.depth_min, 0) AS depth_min,
               coalesce(t.depth_max, t.depth_min, 0) AS depth_max,
               t.dataset_pk::text || ':t:' || coalesce(t.trajectory_id, '') AS feature_key,
               NULL::integer AS point_pk, h.geom AS search_geom, t.day_ranges
        ${TRAJECTORY_COVERAGE_FROM}`;
    const obisBranch = `SELECT dataset_pk, time_min, time_max,
               coalesce(depth_min, 0) AS depth_min,
               coalesce(depth_max, depth_min, 0) AS depth_max,
               NULL::text AS feature_key,
               point_pk, geom AS search_geom, day_ranges
        FROM cde.obis_cells
        WHERE :obisFilters`;
    const griddapBranch = `SELECT d.pk AS dataset_pk,
               ${GRIDDAP_TIME_DEPTH_COLUMNS},
               NULL::text AS feature_key,
               NULL::integer AS point_pk,
               d.coverage_bbox AS search_geom,
               NULL::daterange[] AS day_ranges
        ${GRIDDAP_FROM}`;

    const branches = [];
    if (erddap) branches.push(profilesBranch, trajectoryBranch, griddapBranch);
    if (obis) branches.push(obisBranch);

    // `filtered` also derives each row's series key/kind from the joined
    // dataset, and `spans` turns each row into the stretches of time it
    // actually holds data over. Shared by both queries below; declared as a
    // string so the scan definition stays identical between them. NOTE: knex
    // substitutes named bindings even inside SQL comments, so never write a
    // colon-prefixed word in comments here.
    const combinedAndFiltered = `combined AS (
        ${unionBranches(branches, profilesBranch)}
    ),
    filtered AS (
        SELECT ${entityExpr} AS entity, p.time_min, p.time_max, p.day_ranges,
               ${group.keyExpr} AS series_key,
               ${group.kindExpr} AS series_kind
        FROM   combined p
        JOIN   cde.datasets d
        ON     p.dataset_pk = d.pk
        ${group.join || ""}
        WHERE  ${filters.hasShared ? ":filters" : "TRUE"}
        AND    p.time_max >= :timeStart::timestamptz
        AND    p.time_min <= :timeEnd::timestamptz
        ${count === "features" ? "AND p.feature_key IS NOT NULL" : ""}
    ),
    spans AS (
        SELECT entity, series_key, series_kind,
               lower(r)::timestamp AT TIME ZONE 'UTC' AS span_min,
               (upper(r) - 1)::timestamp AT TIME ZONE 'UTC' AS span_max
        FROM filtered
        CROSS JOIN LATERAL unnest(day_ranges) r
        WHERE day_ranges IS NOT NULL
        UNION ALL
        SELECT entity, series_key, series_kind, time_min, time_max
        FROM filtered
        WHERE coalesce(array_length(day_ranges, 1), 0) = 0
    ),
    /* For the days count: one row per entity carrying every day range it
       holds, plus the extent to pair it against bins cheaply. Rows whose day
       set is unknown contribute their span clamped to the query window, which
       is also what keeps a static grid (time bounds coalesced to infinity in
       selection.js) finite here. day_range_overlap_days unions the array
       before measuring, so ranges arriving from several hexes or cells for the
       same entity overlap harmlessly instead of adding up. */
    row_ranges AS (
        SELECT entity, series_key, series_kind,
               CASE WHEN coalesce(array_length(day_ranges, 1), 0) > 0
                    THEN day_ranges
                    ELSE ARRAY[daterange(
                           clamped_lo::date,
                           GREATEST(clamped_hi::date, clamped_lo::date) + 1)]
               END AS ranges
        FROM filtered
        CROSS JOIN LATERAL (
            SELECT GREATEST(time_min, :timeStart::timestamptz) AS clamped_lo,
                   LEAST(time_max, :timeEnd::timestamptz) AS clamped_hi
        ) clamp
    ),
    entity_ranges AS (
        SELECT entity, series_key, min(series_kind) AS series_kind,
               array_agg(r) AS ranges,
               min(lower(r)) AS d_min, max(upper(r)) AS d_max
        FROM row_ranges
        CROSS JOIN LATERAL unnest(ranges) r
        GROUP BY entity, series_key
    ),
    bins AS (
        SELECT i AS idx,
               daterange(
                 (to_timestamp((:epochStart)::double precision
                   + (i - 1) * (:binWidthSec)::double precision) AT TIME ZONE 'UTC')::date,
                 (to_timestamp((:epochStart)::double precision
                   + i * (:binWidthSec)::double precision) AT TIME ZONE 'UTC')::date
               ) AS win
        FROM generate_series(1, (:numTimeBins)::integer) i
    )`;

    // Cells: bucket each span into a 1-based bin-index range, collapse to
    // DISTINCT (entity, series, tb0, tb1) tuples first (buckets are coarse, so
    // a dataset's spans mostly share a tuple), then expand into the bins each
    // tuple covers and count distinct entities per (bin, series).
    // Days: each entity's own day set, measured against each bin it reaches
    // and then ADDED UP across entities — so two moorings recording the same
    // 90 days contribute 180. That is observation effort, not calendar
    // coverage, and it deliberately differs from the map's `days` ramp, which
    // unions instead (utils/hexMetric.js). A bar can exceed the number of
    // calendar days in its period; the figure says so.
    const daysCellsSql = `WITH ${combinedAndFiltered}
    SELECT b.idx AS t, e.series_key,
           sum(day_range_overlap_days(e.ranges, b.win))::integer AS count
    FROM entity_ranges e
    JOIN bins b ON daterange(e.d_min, e.d_max) && b.win
    GROUP BY b.idx, e.series_key
    HAVING sum(day_range_overlap_days(e.ranges, b.win)) > 0`;

    const daysSeriesSql = `WITH ${combinedAndFiltered}
    SELECT series_key, min(series_kind) AS series_kind,
           sum(day_range_overlap_days(ranges, :windowRange::daterange))::integer AS total
    FROM entity_ranges
    GROUP BY series_key
    ORDER BY total DESC`;

    const entityCellsSql = `WITH ${combinedAndFiltered},
    bucketed AS (
        SELECT DISTINCT entity, series_key,
            least(greatest(width_bucket(
                extract(epoch from greatest(span_min, :timeStart::timestamptz))::double precision,
                (:epochStart)::double precision, (:epochEnd)::double precision, (:numTimeBins)::integer
            ), 1), (:numTimeBins)::integer) AS tb0,
            least(greatest(width_bucket(
                extract(epoch from least(span_max, :timeEnd::timestamptz))::double precision,
                (:epochStart)::double precision, (:epochEnd)::double precision, (:numTimeBins)::integer
            ), 1), (:numTimeBins)::integer) AS tb1
        FROM spans
        WHERE span_max >= :timeStart::timestamptz
        AND   span_min <= :timeEnd::timestamptz
    ),
    expanded AS (
        SELECT DISTINCT entity, series_key, t.t
        FROM bucketed
        CROSS JOIN LATERAL generate_series(tb0, tb1) AS t(t)
    )
    SELECT t, series_key, count(*)::integer AS count
    FROM expanded
    GROUP BY t, series_key`;

    // Series totals: distinct entities per series over the whole window (not
    // the sum of per-bin counts, which would multiply a long-lived dataset
    // across its bins). Read from the same spans as the bars, so a row whose
    // extent overlaps the window but whose real day set does not is absent
    // from both. Used to rank series and pick the top ones.
    const entitySeriesSql = `WITH ${combinedAndFiltered}
    SELECT series_key, min(series_kind) AS series_kind,
           count(DISTINCT entity)::integer AS total
    FROM spans
    WHERE span_max >= :timeStart::timestamptz
    AND   span_min <= :timeEnd::timestamptz
    GROUP BY series_key
    ORDER BY total DESC`;

    const cellsSql = count === "days" ? daysCellsSql : entityCellsSql;
    const seriesSql = count === "days" ? daysSeriesSql : entitySeriesSql;

    const bindings = {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
      timeStart: new Date(timeBins.start).toISOString(),
      timeEnd: new Date(timeBins.end).toISOString(),
      epochStart: timeBins.start / 1000,
      epochEnd: timeBins.end / 1000,
      numTimeBins: timeBins.numBins,
      // The days query builds its bins as date ranges rather than by bucketing
      // an epoch, because a day set is measured in whole UTC days.
      binWidthSec: (timeBins.end - timeBins.start) / 1000 / timeBins.numBins,
      windowRange:
        `[${new Date(timeBins.start).toISOString().slice(0, 10)},` +
        `${new Date(timeBins.end).toISOString().slice(0, 10)})`,
    };

    // Both scan the same tables independently; run concurrently so latency is
    // bounded by the slower, not their sum (as /legend does).
    const [cellRows, seriesRows] = await Promise.all([
      db.raw(cellsSql, bindings),
      db.raw(seriesSql, bindings),
    ]);

    res.send({
      groupBy: groupByKey,
      count,
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
