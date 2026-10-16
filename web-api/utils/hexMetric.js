// The hex ramp's metric, shared by routes/tiles.js and routes/legend.js: if
// they disagree the ramp silently mis-colours.
//
// `records` sums n_records across sources even though they count different
// things (measurement rows, occurrences, position fixes) — one comparable
// "amount of data" ramp beats three incomparable ones.
//
// `days` is DISTINCT UTC days, a union of each row's day set, not a sum:
// summing made one hex read 451,305 days over a 5,197-day span.
//
// `datasets` is a small integer (1..~12), so it gets a linear ramp, not log.

const METRICS = ["records", "days", "datasets"];
const DEFAULT_METRIC = "records";

// Allowlisted, so the expressions below are safe to inline.
function parseMetric(value) {
  return METRICS.includes(value) ? value : DEFAULT_METRIC;
}

// n_records is nullable on the cell/hex tables and a NULL would poison the
// hex's sum.
const RECORDS = {
  profiles: "coalesce(n_records, 0)",
  trajectory_hexes: "coalesce(n_records, 0)",
  obis_cells: "coalesce(n_records, 0)",
  hexes_zoom_0_rollup: "n_records",
};

// A NULL/empty day_ranges (not re-harvested since
// database/3_day_ranges_migration.sql, or a single-cast Profile) falls back
// to the [time_min, time_max] span. GREATEST guards time_max < time_min,
// which daterange() rejects; LEFT keeps a dayless row in the dataset list.
const DAY_SET_JOIN = `LEFT JOIN LATERAL (
      SELECT r AS day
        FROM unnest(day_ranges) r
       WHERE day_ranges IS NOT NULL
      UNION ALL
      SELECT daterange(time_min::date, GREATEST(time_max::date, time_min::date) + 1)
       WHERE coalesce(array_length(day_ranges, 1), 0) = 0
         AND time_min IS NOT NULL
    ) metric_days ON true`;

// Typed bigint or daterange by metric, which is why the empty-UNION guard in
// utils/selection.js wraps a real branch rather than a typed NULL.
function metricValueExpr(table, metric) {
  if (metric === "days") return "metric_days.day as metric_value";
  if (metric === "datasets") return "0 as metric_value";
  return `${RECORDS[table]} as metric_value`;
}

// Goes immediately after `FROM <table>` in a branch.
function metricJoin(table, metric) {
  if (metric !== "days") return "";
  // The rollup's day sets already carry the span fallback, merged.
  return table === "hexes_zoom_0_rollup"
    ? "LEFT JOIN LATERAL unnest(day_ranges) metric_days(day) ON true"
    : DAY_SET_JOIN;
}

// `filter` restricts to a source, for the coverage tooltip's breakdown.
function countAggregate(metric, alias, filter) {
  const where = filter ? ` FILTER (WHERE ${filter})` : "";
  if (metric === "datasets") {
    return `(count(distinct ${alias}.dataset_pk)${where})::bigint`;
  }
  if (metric === "days") {
    // day_union_days (database/8_range_functions.sql) absorbs NULL elements
    // and arrays, so no coalesce is needed.
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
  countAggregate,
};
