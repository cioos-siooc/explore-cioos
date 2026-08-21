/*
 * What the map's hex colour ramp counts.
 *
 * The tiles (routes/tiles.js) emit the number and /legend (routes/legend.js)
 * derives the ramp's min/max from the same number. If the two ever disagree the
 * ramp silently mis-colours — every hex saturated, or every hex the lightest
 * shade — so both routes take their SQL from here rather than spelling it out
 * twice.
 *
 * The metric answers "how much data was collected here", which is why
 * `records` is the default: the map's job is to make a 20-year hourly mooring
 * read as denser than a single CTD cast. Counting distinct locations (what this
 * used to do) made them identical.
 *
 * Caveat carried by `records`, surfaced in the legend rather than hidden here:
 * the three sources count different things — ERDDAP n_records are measurement
 * rows, OBIS n_records are occurrence records, trajectory n_records are
 * position fixes — and some ERDDAP counts are extrapolated estimates rather
 * than exact (see get_count in the harvester). Summing them is a deliberate
 * choice: one comparable "amount of data" ramp beats three incomparable ones.
 * The coverage-hex tooltip keeps the per-source breakdown.
 *
 * `days` is the unit-safe alternative — one meaning across all three sources —
 * at the cost of ranking a daily-sampled and an hourly-sampled mooring equally.
 * It is the number of DISTINCT UTC days a hex holds data for, not the sum of
 * each feature's day count: ten moorings deployed over the same year read as
 * 365 days, not 3650. That distinction is the whole point of the metric — hexes
 * accumulate features (a well-instrumented harbour easily holds thousands), so
 * summing turned "days of data" into a second, noisier records count that no
 * longer had a calendar meaning. Unlike the other two metrics it therefore
 * can't be a per-row number summed up: each row contributes a set of days
 * (`metricValueExpr` + `metricJoin` below), and the aggregate unions them.
 *
 * `datasets` counts distinct datasets instead of summing anything. It answers
 * "how many different things were measured here" rather than "how much", and
 * unlike the other two it is a small integer (1..~12 across the catalogue), so
 * it gets an evenly-spread ramp instead of a log one. It is the metric to
 * reach for when the record counts bunch up — they span eight orders of
 * magnitude and are dominated by a handful of high-rate instruments, which
 * makes broad regions read as uniformly dark.
 */

const METRICS = ["records", "days", "datasets"];
const DEFAULT_METRIC = "records";

// Allowlisted, so the expressions below are safe to inline into the branch SQL
// (they carry no user input at all — same pattern as profileTypes in tiles.js).
function parseMetric(value) {
  return METRICS.includes(value) ? value : DEFAULT_METRIC;
}

// n_records is nullable on the cell/hex tables (only profiles.n_records is
// guaranteed by validate_loaded_data), and a NULL would poison the sum for the
// whole hex — hence coalesce, not optimism.
// `datasets` is 0 here because it aggregates dataset_pk (already carried by
// every branch) rather than summing a per-row quantity — see countAggregate.
const RECORDS = {
  profiles: "coalesce(n_records, 0)",
  trajectory_hexes: "coalesce(n_records, 0)",
  obis_cells: "coalesce(n_records, 0)",
};

// `days` is a set union, so each row contributes day RANGES rather than a
// number: the branch lateral-joins its days and the aggregate unions them.
// LEFT JOIN keeps a row whose days are unknown (NULL time_min, or a trajectory
// hex predating day_ranges) out of the union without dropping it from the
// hex's dataset list.
//
// profiles/obis_cells have no day-level table, so their span is the best
// available answer — one range per row, upper bound exclusive, so a
// single-instant feature is one day. The GREATEST guards a time_max < time_min
// row, which daterange() would reject outright rather than tolerate.
// trajectory_hexes carries the real day set as runs of consecutive UTC days
// (day_ranges, built by trajectory_build_hexes), so a ship crossing a hex every
// January contributes those days and not the decades between them.
const SPAN_DAYS_JOIN = `LEFT JOIN LATERAL (
      SELECT daterange(time_min::date,
                       GREATEST(time_max::date, time_min::date) + 1) AS day
       WHERE time_min IS NOT NULL
    ) metric_days ON true`;

const DAY_JOINS = {
  profiles: SPAN_DAYS_JOIN,
  obis_cells: SPAN_DAYS_JOIN,
  trajectory_hexes: `LEFT JOIN LATERAL
      unnest(coalesce(day_ranges, '{}'::daterange[])) AS metric_days(day) ON true`,
};

// The per-row quantity a branch contributes to its hex/point bucket, aliased
// metric_value so every branch of the UNION lines up. Its type depends on the
// metric (bigint, or daterange for `days`) — which is why the empty-branch
// guards go through nullMetricExpr rather than hardcoding a 0.
function metricValueExpr(table, metric) {
  if (metric === "days") return "metric_days.day as metric_value";
  if (metric === "datasets") return "0 as metric_value";
  return `${RECORDS[table]} as metric_value`;
}

// Goes immediately after `FROM <table>` in a branch: the join supplying
// metric_value, or nothing when the metric is a plain per-row number.
function metricJoin(table, metric) {
  return metric === "days" ? DAY_JOINS[table] : "";
}

// For the "nothing to show" branches both routes keep so the CTE still has the
// right columns. Typed, because `days` aggregates dateranges.
function nullMetricExpr(metric) {
  return metric === "days"
    ? "NULL::daterange as metric_value"
    : "NULL::bigint as metric_value";
}

// The aggregate that produces a bucket's `count`, over rows qualified by
// `alias` (a table alias or CTE name), optionally restricted by `filter` (a
// SQL condition, for the per-source figures the coverage tooltip names). Every
// caller — both tile routes and both legend queries — goes through this so the
// tiles and the ramp domain can't end up aggregating differently.
function countAggregate(metric, alias, filter) {
  const where = filter ? ` FILTER (WHERE ${filter})` : "";
  if (metric === "datasets") {
    return `(count(distinct ${alias}.dataset_pk)${where})::bigint`;
  }
  if (metric === "days") {
    // day_union_days (database/8_range_functions.sql) merges the ranges and
    // counts overlaps once. It absorbs NULL elements and a NULL array (an
    // all-unknown or empty bucket), so no coalesce is needed here.
    return `day_union_days(array_agg(${alias}.metric_value)${where})`;
  }
  return `coalesce(sum(${alias}.metric_value)${where}, 0)::bigint`;
}

module.exports = {
  METRICS,
  DEFAULT_METRIC,
  parseMetric,
  metricValueExpr,
  metricJoin,
  nullMetricExpr,
  countAggregate,
};
