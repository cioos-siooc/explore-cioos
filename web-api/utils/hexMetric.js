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

// n_records and days are nullable on both cell tables (only profiles.n_records
// is guaranteed by validate_loaded_data), and a NULL would poison the sum for
// the whole hex — hence coalesce, not optimism.
// `datasets` is 0 here because it aggregates dataset_pk (already carried by
// every branch) rather than summing a per-row quantity — see countAggregate.
const EXPRESSIONS = {
  profiles: {
    records: "coalesce(n_records, 0)",
    days: "coalesce(days, 0)",
    datasets: "0",
  },
  trajectory_cells: {
    records: "coalesce(n_records, 0)",
    days: "coalesce(days, 0)",
    datasets: "0",
  },
  obis_cells: {
    records: "coalesce(n_records, 0)",
    // obis_cells has no days column; the cell's time span is the equivalent.
    days: "date_part('days', time_max - time_min) + 1",
    datasets: "0",
  },
};

// The per-row quantity summed into a hex/point count, aliased as record_count
// so every branch of the UNION lines up.
function recordCountExpr(table, metric) {
  return `${EXPRESSIONS[table][metric]} as record_count`;
}

// The aggregate that produces a bucket's `count`, over rows qualified by
// `alias` (a table alias or CTE name). Every caller — both tile routes and
// both legend queries — goes through this so the tiles and the ramp domain
// can't end up aggregating differently.
function countAggregate(metric, alias) {
  return metric === "datasets"
    ? `count(distinct ${alias}.dataset_pk)::bigint`
    : `coalesce(sum(${alias}.record_count), 0)::bigint`;
}

module.exports = {
  METRICS,
  DEFAULT_METRIC,
  parseMetric,
  recordCountExpr,
  countAggregate,
};
