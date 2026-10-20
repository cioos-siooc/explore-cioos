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

const DAY_MS = 86400000;
const YEAR_MS = 365.25 * DAY_MS;
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
// The default 1900-to-now window lands on the half-year rung.
const TARGET_TIME_BINS = 300;

// Deliberately not the `metric` parameter: that one belongs to the hex ramp
// (utils/hexMetric.js) and the shared filter validators check it strictly.
const COUNTS = ["datasets", "features", "days"];

// `d` is the cde.datasets alias in the query below.
const GROUP_BY = {
  source: {
    // OBIS datasets carry the https://obis.org sentinel erddap_url; their real
    // provenance is the OBIS node.
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
  // Multi-valued: a dataset with N organizations lands in N series, so the
  // stacked bars sum above the dataset count, matching the organizations
  // filter's array-overlap semantics.
  organization: {
    join:
      "CROSS JOIN LATERAL unnest(CASE WHEN coalesce(array_length(d.organizations, 1), 0) = 0 " +
      "THEN ARRAY['unknown']::text[] ELSE d.organizations END) AS org(name)",
    keyExpr: "org.name",
    kindExpr: "'organization'",
  },
};

const VIEWS = ["timeline", "seasonal"];
// Seasonal bins are 7-day blocks from Jan 1, so the last one runs Dec 24 to
// Dec 31 (one or two days longer) and every year folds onto the same 52.
const WEEKS_PER_YEAR = 52;
// Non-leap year the seasonal edges are reported in; only month and day matter.
const SEASONAL_REFERENCE_YEAR = 2001;

function selectionWindow(timeMin, timeMax, extent = {}) {
  // Same defaults as the frontend's time slider (config.js): the filter query
  // string omits them when untouched.
  const windowStart = new Date(timeMin || "1900-01-01T00:00:00Z").getTime();
  const windowEnd = timeMax ? new Date(timeMax).getTime() : Date.now();
  // Bins span the selection's data, not the whole window, so an untouched
  // 1900-to-now filter doesn't bury recent data in empty bars.
  const start = extent.min
    ? Math.max(windowStart, new Date(extent.min).getTime())
    : windowStart;
  let end = extent.max
    ? Math.min(windowEnd, new Date(extent.max).getTime() + DAY_MS)
    : windowEnd;
  if (end <= start) end = start + DAY_MS;
  return { windowStart, start, end };
}

function weekOfYear(ms) {
  const date = new Date(ms);
  const dayOfYear = Math.floor(
    (ms - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS,
  );
  return Math.min(WEEKS_PER_YEAR, Math.floor(dayOfYear / 7) + 1);
}

/*
 * The first and last bins are cut at the window rather than rounded out to a
 * week boundary: the days query clips its islands by the bin edges alone, so
 * an edge before timeMin would count days the filter excludes.
 */
function buildSeasonalBins({ start, end }) {
  const edgesMs = [start];
  const firstYear = new Date(start).getUTCFullYear();
  const lastYear = new Date(end).getUTCFullYear();
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (let week = 0; week < WEEKS_PER_YEAR; week += 1) {
      const edge = Date.UTC(year, 0, 1 + 7 * week);
      if (edge > start && edge < end) edgesMs.push(edge);
    }
  }
  edgesMs.push(end);
  const edges = edgesMs.map((ms) => new Date(ms).toISOString());
  const outputEdges = Array.from({ length: WEEKS_PER_YEAR + 1 }, (_, week) =>
    new Date(
      week === WEEKS_PER_YEAR
        ? Date.UTC(SEASONAL_REFERENCE_YEAR + 1, 0, 1)
        : Date.UTC(SEASONAL_REFERENCE_YEAR, 0, 1 + 7 * week),
    ).toISOString(),
  );
  return {
    edges,
    dateEdges: edges.map((e) => e.slice(0, 10)),
    binGroups: edgesMs.slice(0, -1).map(weekOfYear),
    // 52 consecutive bins already hold every week.
    foldSpan: WEEKS_PER_YEAR - 1,
    outputEdges,
    start,
    end,
    numBins: edgesMs.length - 1,
  };
}

function buildTimeBins(timeMin, timeMax, extent = {}) {
  const span = selectionWindow(timeMin, timeMax, extent);
  const { windowStart, end } = span;
  let { start } = span;

  const rawWidth = (end - start) / TARGET_TIME_BINS;
  const width =
    TIME_BIN_WIDTHS_MS.find((w) => w >= rawWidth) ||
    TIME_BIN_WIDTHS_MS[TIME_BIN_WIDTHS_MS.length - 1];
  // Year-wide bins open on Jan 1 to match the figure's calendar-year labels.
  if (width >= YEAR_MS) {
    start = Math.max(
      windowStart,
      Date.UTC(new Date(start).getUTCFullYear(), 0, 1),
    );
  }
  const numBins = Math.max(1, Math.ceil((end - start) / width));
  const edges = Array.from({ length: numBins + 1 }, (_, i) =>
    new Date(start + i * width).toISOString(),
  );
  // The days count bins on whole UTC dates rather than timestamps.
  const dateEdges = edges.map((e) => e.slice(0, 10));
  return {
    edges,
    dateEdges,
    binGroups: Array.from({ length: numBins }, (_, i) => i + 1),
    foldSpan: numBins,
    outputEdges: edges,
    start,
    end: start + numBins * width,
    numBins,
  };
}

/*
 * Only sound where a series' window total is the sum of its bins (days, not
 * the entity counts). Sorted descending because the figure keeps the top few
 * series and folds the rest into "Other" (CoverageHistogramPlot's MAX_SERIES).
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
 *         name: view
 *         schema: { type: string, enum: [timeline, seasonal] }
 *         description: >
 *           `timeline` (default) bins along the time window. `seasonal` folds
 *           every year in it onto 52 weeks of the year (7-day blocks from
 *           Jan 1; the last runs to Dec 31), and timeBinEdges are then given in
 *           a non-leap reference year whose year carries no meaning.
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
  ...pipeline({
    checks: [
      check("count").isIn(COUNTS).optional(),
      check("view").isIn(VIEWS).optional(),
    ],
  }),
  async (req, res) => {
    const groupByKey = Object.prototype.hasOwnProperty.call(
      GROUP_BY,
      req.query.groupBy,
    )
      ? req.query.groupBy
      : "source";
    const group = GROUP_BY[groupByKey];
    const count = COUNTS.includes(req.query.count)
      ? req.query.count
      : "datasets";
    const view = req.query.view === "seasonal" ? "seasonal" : "timeline";

    const filters = await createDBFilter(req.query);

    const { timeMin, timeMax } = req.query;

    const erddap = erddapVisible(req.query);
    const obis = obisVisible(req.query);

    // For "days" the unit is the feature, falling back to the dataset where
    // there is no cf_role. feature_key always contains a colon, so it can never
    // collide with a bare dataset pk.
    const entityExpr =
      count === "features"
        ? "p.feature_key"
        : count === "days"
          ? "coalesce(p.feature_key, p.dataset_pk::text)"
          : "p.dataset_pk::text";

    // Depth NULLs coalesce to 0 so the shared depth filter treats depth-less
    // features as surface.
    //
    // point_pk is carried on every branch because a map-click selection puts
    // an unqualified point_pk predicate in the shared filter; a branch missing
    // the name makes the whole statement fail to parse.
    //
    // OBIS and griddap have no cf_role, so their NULL feature_key drops them
    // out of the "features" count.
    const profilesBranch = `SELECT dataset_pk, time_min, time_max,
               coalesce(depth_min, 0) AS depth_min,
               coalesce(depth_max, depth_min, 0) AS depth_max,
               dataset_pk::text || ':p:' || coalesce(timeseries_id, '')
                 || '|' || coalesce(profile_id, '') AS feature_key,
               point_pk, bbox AS search_geom, day_ranges
        FROM cde.profiles
        WHERE :profileFilters`;
    // One tier only (see utils/selection.js); both tiers would count each
    // trajectory twice.
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

    // Each count builds its own CTE list rather than sharing one: an unread
    // `spans` CTE references `filtered` twice, which forces PostgreSQL to
    // materialize it. NOTE: knex substitutes named bindings even inside SQL
    // comments, so never write a colon-prefixed word in comments here.
    const combinedSql = `combined AS (
        ${unionBranches(branches, profilesBranch)}
    )`;

    const filterBindings = {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
    };
    const {
      rows: [extent],
    } = await db.raw(
      `WITH ${combinedSql}
    SELECT min(p.time_min) AS min, max(p.time_max) AS max
    FROM   combined p
    JOIN   cde.datasets d
    ON     p.dataset_pk = d.pk
    WHERE  ${filters.hasShared ? ":filters" : "TRUE"}`,
      filterBindings,
    );
    const timeBins =
      view === "seasonal"
        ? buildSeasonalBins(selectionWindow(timeMin, timeMax, extent))
        : buildTimeBins(timeMin, timeMax, extent);

    const windowClause = `WHERE  ${filters.hasShared ? ":filters" : "TRUE"}
        AND    p.time_max >= :timeStart::timestamptz
        AND    p.time_min <= :timeEnd::timestamptz`;

    /*
     * Days: union within a feature, then sum across features. A trajectory is
     * one row per hex and OBIS one row per cell, so without the union a ship
     * crossing fifty hexes in a day contributes fifty days. Summing across
     * features is deliberately unlike the map's `days` ramp
     * (utils/hexMetric.js), which unions: it measures observation effort, so a
     * bar can exceed the calendar days in its period.
     *
     * The union is a single gaps-and-islands merge per feature; calling
     * day_range_overlap_days() per (feature, bin) re-sorted each array on every
     * call. It runs before the cde.datasets join so the series key never
     * enters the sort and the organization lateral multiplies islands, not
     * ranges.
     */
    const daysSql = `WITH ${combinedSql},
    filtered AS (
        SELECT p.dataset_pk, p.feature_key, p.time_min, p.time_max, p.day_ranges
        FROM   combined p
        JOIN   cde.datasets d
        ON     p.dataset_pk = d.pk
        ${windowClause}
    ),
    /* A feature with no day set (griddap) contributes its extent clamped to
       the query window instead. */
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
    /* Abutting ranges merge because the bounds are half-open, so lower equal
       to the previous upper is not a gap. */
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
    /* Bound once and read through uncorrelated scalar subqueries (evaluated
       once as an InitPlan) instead of inlining the array at every use. grp is
       the bar each bin is drawn in: itself on the timeline, its week of the
       year in the seasonal view. */
    bin_edges AS (
        SELECT (:binEdges)::date[] AS ed, (:binGroups)::integer[] AS grp
    ),
    bins AS (
        SELECT idx::integer AS idx, grp[idx] AS grp, edge AS win_lo,
               lead(edge) OVER (ORDER BY idx) AS win_hi
        FROM bin_edges
        CROSS JOIN LATERAL unnest(ed) WITH ORDINALITY AS b(edge, idx)
    )
    SELECT b.grp AS t, a.series_key, min(a.series_kind) AS series_kind,
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
    GROUP BY b.grp, a.series_key
    HAVING sum(LEAST(a.hi, b.win_hi) - GREATEST(a.lo, b.win_lo)) > 0`;

    // `spans` uses the observation-day set where known, else the extent.
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

    // DISTINCT before expanding because a dataset's coarse-bucketed spans
    // mostly share a tuple. The fold comes before the distinct count, so a
    // dataset with data in week 10 of five years counts once there.
    const entityCellsSql = `WITH ${entityCtes},
    bin_edges AS (
        SELECT (:timeEdges)::timestamptz[] AS ed, (:binGroups)::integer[] AS grp
    ),
    bucketed AS (
        SELECT DISTINCT entity, series_key,
            least(greatest(width_bucket(
                greatest(span_min, :timeStart::timestamptz),
                (SELECT ed FROM bin_edges)
            ), 1), (:numTimeBins)::integer) AS tb0,
            least(greatest(width_bucket(
                least(span_max, :timeEnd::timestamptz),
                (SELECT ed FROM bin_edges)
            ), 1), (:numTimeBins)::integer) AS tb1
        FROM spans
        WHERE span_max >= :timeStart::timestamptz
        AND   span_min <= :timeEnd::timestamptz
    ),
    expanded AS (
        SELECT DISTINCT entity, series_key,
               ((SELECT grp FROM bin_edges))[t.t] AS t
        FROM bucketed
        CROSS JOIN LATERAL generate_series(
            tb0, LEAST(tb1, tb0 + (:foldSpan)::integer)) AS t(t)
    )
    SELECT t, series_key, count(*)::integer AS count
    FROM expanded
    GROUP BY t, series_key`;

    // A distinct count over the whole window, not the sum of per-bin counts,
    // which would multiply a long-lived dataset across its bins.
    const entitySeriesSql = `WITH ${entityCtes}
    SELECT series_key, min(series_kind) AS series_kind,
           count(DISTINCT entity)::integer AS total
    FROM spans
    WHERE span_max >= :timeStart::timestamptz
    AND   span_min <= :timeEnd::timestamptz
    GROUP BY series_key
    ORDER BY total DESC`;

    const bindings = {
      ...filterBindings,
      timeStart: new Date(timeBins.start).toISOString(),
      timeEnd: new Date(timeBins.end).toISOString(),
      numTimeBins: timeBins.numBins,
      timeEdges: timeBins.edges,
      binGroups: timeBins.binGroups,
      foldSpan: timeBins.foldSpan,
      binEdges: timeBins.dateEdges,
    };

    // The bins tile the window exactly, so a days series' total is the sum of
    // its bars; entity totals are distinct counts, not additive, and need a
    // second query.
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
      view,
      timeBinEdges: timeBins.outputEdges,
      series,
      cells: cellRows.rows.map((r) => [r.t, r.series_key, r.count]),
    });
  },
);

module.exports = router;
