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
  GRIDDAP_EXACT_TIME_DEPTH_COLUMNS,
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
// Bars to aim for. High enough that the default 1900-to-now window lands on
// the one-year rung rather than the five-year one; a zoomed-in time filter
// still walks down the ladder to weeks or days, so there is no floor.
const TARGET_TIME_BINS = 150;

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
  // The same edges as whole UTC days. The days count measures a day set, so it
  // bins on dates rather than bucketing an epoch; slicing the ISO string is
  // exactly what the old to_timestamp(...) AT TIME ZONE 'UTC' cast produced.
  const dateEdges = edges.map((e) => e.slice(0, 10));
  return { edges, dateEdges, start, end: start + numBins * width, numBins };
}

/*
 * The series list for an additive count, folded out of the bars.
 *
 * Only sound where a series' window total is the sum of its bins, which is
 * true of days and false of the entity counts — see the call site. Sorted
 * descending because the figure takes the top few series by total and folds
 * the rest into "Other" (CoverageHistogramPlot's MAX_SERIES).
 */
function rankSeriesFromCells(rows) {
  const totals = new Map();
  for (const row of rows) {
    const seen = totals.get(row.series_key);
    if (seen) seen.total += row.count;
    else
      totals.set(row.series_key, {
        key: row.series_key,
        kind: row.series_kind,
        total: row.count,
      });
  }
  return [...totals.values()].sort((a, b) => b.total - a.total);
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
               ${GRIDDAP_EXACT_TIME_DEPTH_COLUMNS},
               NULL::text AS feature_key,
               NULL::integer AS point_pk,
               d.coverage_bbox AS search_geom,
               NULL::daterange[] AS day_ranges
        ${GRIDDAP_FROM}`;

    const branches = [];
    if (erddap) branches.push(profilesBranch, trajectoryBranch, griddapBranch);
    if (obis) branches.push(obisBranch);

    // `combined` is the selection's row set; `filtered` applies the shared
    // filter and the query window to it. Both counts start here, but they
    // diverge immediately afterwards, so each builds its own CTE list rather
    // than sharing one string: the days path used to carry the `spans` CTE it
    // never reads, and because `spans` scans `filtered` twice that alone
    // pushed `filtered` past one reference and forced PostgreSQL to
    // materialize it. NOTE: knex substitutes named bindings even inside SQL
    // comments, so never write a colon-prefixed word in comments here.
    const combinedSql = `combined AS (
        ${unionBranches(branches, profilesBranch)}
    )`;

    const windowClause = `WHERE  ${filters.hasShared ? ":filters" : "TRUE"}
        AND    p.time_max >= :timeStart::timestamptz
        AND    p.time_min <= :timeEnd::timestamptz`;

    /*
     * The days count.
     *
     * The unit is the FEATURE and the aggregation is two-level: union within a
     * feature, then sum ACROSS features. A trajectory is stored as one row per
     * hex and an OBIS dataset as one row per cell, so a platform that moved
     * holds many rows covering the same day; those have to be unioned up to the
     * feature before anything is added, or a ship crossing fifty hexes in a day
     * contributes fifty days. Summing across features is the deliberate
     * opposite of the map's `days` ramp (utils/hexMetric.js), which unions
     * instead: two moorings recording the same 90 days contribute 180. That is
     * observation effort, not calendar coverage, so a bar can exceed the number
     * of calendar days in its period. The figure says so.
     *
     * The union is done ONCE per feature here, as a gaps-and-islands merge into
     * disjoint ranges, instead of by calling day_range_overlap_days() for every
     * (feature, bin) pair — that re-unnested and re-sorted the feature's whole
     * array on each call, and the range-overlap join that fed it compared every
     * feature against every bin. Once the islands are disjoint, a bin's days
     * are plain arithmetic and a plain sum.
     *
     * The merge runs BEFORE the cde.datasets join so the series key — an
     * ERDDAP server URL — never enters the sort, and so the organization
     * lateral multiplies the islands rather than the ranges.
     */
    const daysSql = `WITH ${combinedSql},
    filtered AS (
        SELECT p.dataset_pk, p.feature_key, p.time_min, p.time_max, p.day_ranges
        FROM   combined p
        JOIN   cde.datasets d
        ON     p.dataset_pk = d.pk
        ${windowClause}
    ),
    /* One row per day range. A feature whose day set is unknown contributes
       its extent clamped to the query window instead, which is what bounds a
       griddap row: it has no day ranges at all, only the coverage extent. A
       grid with no time coverage never reaches here, since the exact columns
       leave its bounds NULL and the window comparison above drops it. */
    range_rows AS (
        SELECT dataset_pk, feature_key, lower(r) AS lo, upper(r) AS hi
        FROM filtered
        CROSS JOIN LATERAL (
            SELECT GREATEST(time_min, :timeStart::timestamptz)::date AS clamped_lo,
                   LEAST(time_max, :timeEnd::timestamptz)::date AS clamped_hi
        ) clamp
        CROSS JOIN LATERAL unnest(
            CASE WHEN coalesce(array_length(day_ranges, 1), 0) > 0
                 THEN day_ranges
                 ELSE ARRAY[daterange(clamp.clamped_lo,
                            GREATEST(clamp.clamped_hi, clamp.clamped_lo) + 1)]
            END
        ) r
        WHERE r IS NOT NULL AND NOT isempty(r)
    ),
    /* Gaps and islands. Ordered by start, a range opens a new island when it
       begins after the furthest end seen so far in the feature; otherwise it
       extends the current one. Abutting ranges merge because the bounds are
       half-open, so lower = previous upper is not a gap. */
    islands AS (
        SELECT dataset_pk, min(lo) AS lo, max(hi) AS hi
        FROM (
            SELECT dataset_pk, feature_key, lo, hi,
                   sum(starts_island) OVER (PARTITION BY dataset_pk, feature_key
                                            ORDER BY lo, hi
                                            ROWS UNBOUNDED PRECEDING) AS island
            FROM (
                SELECT dataset_pk, feature_key, lo, hi,
                       CASE WHEN lo > max(hi) OVER (
                                PARTITION BY dataset_pk, feature_key
                                ORDER BY lo, hi
                                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
                            THEN 1 ELSE 0 END AS starts_island
                FROM range_rows
            ) marked
        ) grouped
        GROUP BY dataset_pk, feature_key, island
    ),
    attributed AS (
        SELECT ${group.keyExpr} AS series_key,
               ${group.kindExpr} AS series_kind,
               i.lo, i.hi
        FROM islands i
        JOIN cde.datasets d ON i.dataset_pk = d.pk${
          group.join ? `\n        ${group.join}` : ""
        }
    ),
    /* The bin edges, bound once. Every reference below is an uncorrelated
       scalar subquery, which PostgreSQL evaluates a single time as an InitPlan
       — spelling the array inline instead put a copy of all 128 dates at six
       places in the statement. */
    bin_edges AS (
        SELECT (:binEdges)::date[] AS ed
    ),
    bins AS (
        SELECT idx::integer AS idx, edge AS win_lo,
               lead(edge) OVER (ORDER BY idx) AS win_hi
        FROM bin_edges
        CROSS JOIN LATERAL unnest(ed) WITH ORDINALITY AS b(edge, idx)
    )
    SELECT b.idx AS t, a.series_key, min(a.series_kind) AS series_kind,
           sum(LEAST(a.hi, b.win_hi) - GREATEST(a.lo, b.win_lo))::integer AS count
    FROM attributed a
    CROSS JOIN LATERAL generate_series(
        GREATEST(width_bucket(a.lo, (SELECT ed FROM bin_edges)), 1),
        LEAST(width_bucket(a.hi - 1, (SELECT ed FROM bin_edges)),
              (:numTimeBins)::integer)
    ) AS g(t)
    JOIN bins b ON b.idx = g.t
    WHERE a.hi > (SELECT ed[1] FROM bin_edges)
    AND   a.lo < (SELECT ed[array_length(ed, 1)] FROM bin_edges)
    GROUP BY b.idx, a.series_key
    HAVING sum(LEAST(a.hi, b.win_hi) - GREATEST(a.lo, b.win_lo)) > 0`;

    // The datasets / features counts. `spans` turns each row into the
    // stretches of time it actually holds data over, built from the real
    // observation-day set wherever it is known and falling back to the extent
    // where it is not.
    const entityCtes = `${combinedSql},
    filtered AS (
        SELECT ${entityExpr} AS entity, p.time_min, p.time_max, p.day_ranges,
               ${group.keyExpr} AS series_key,
               ${group.kindExpr} AS series_kind
        FROM   combined p
        JOIN   cde.datasets d
        ON     p.dataset_pk = d.pk
        ${group.join || ""}
        ${windowClause}
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
    )`;

    // Cells: bucket each span into a 1-based bin-index range, collapse to
    // DISTINCT (entity, series, tb0, tb1) tuples first (buckets are coarse, so
    // a dataset's spans mostly share a tuple), then expand into the bins each
    // tuple covers and count distinct entities per (bin, series).
    const entityCellsSql = `WITH ${entityCtes},
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
    //
    // The days count needs no query of its own here: the bins tile the window
    // exactly, so summing a series' bars IS its total over the window, and
    // deriving it below cannot disagree with the bars the way a second scan
    // could.
    const entitySeriesSql = `WITH ${entityCtes}
    SELECT series_key, min(series_kind) AS series_kind,
           count(DISTINCT entity)::integer AS total
    FROM spans
    WHERE span_max >= :timeStart::timestamptz
    AND   span_min <= :timeEnd::timestamptz
    GROUP BY series_key
    ORDER BY total DESC`;

    const bindings = {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
      timeStart: new Date(timeBins.start).toISOString(),
      timeEnd: new Date(timeBins.end).toISOString(),
      epochStart: timeBins.start / 1000,
      epochEnd: timeBins.end / 1000,
      numTimeBins: timeBins.numBins,
      // The days query bins on whole UTC days rather than by bucketing an
      // epoch, so it takes the edges as dates and binary-searches them.
      binEdges: timeBins.dateEdges,
    };

    // The days count answers both halves of the response from one scan: the
    // bins tile the window exactly, so a series' total over the window IS the
    // sum of its bars, and folding it out of them here cannot disagree with
    // them the way a second scan could. The entity counts cannot do that —
    // their total is a distinct count, which is not additive across bins — so
    // they run a second query, concurrently, leaving latency bounded by the
    // slower of the two rather than their sum (as /legend does).
    let cellRows;
    let series;
    if (count === "days") {
      cellRows = await db.raw(daysSql, bindings);
      series = rankSeriesFromCells(cellRows.rows);
    } else {
      const [cells, totals] = await Promise.all([
        db.raw(entityCellsSql, bindings),
        db.raw(entitySeriesSql, bindings),
      ]);
      cellRows = cells;
      series = totals.rows.map((r) => ({
        key: r.series_key,
        kind: r.series_kind,
        total: r.total,
      }));
    }

    res.send({
      groupBy: groupByKey,
      count,
      timeBinEdges: timeBins.edges,
      series,
      cells: cellRows.rows.map((r) => [r.t, r.series_key, r.count]),
    });
  },
);

module.exports = router;
