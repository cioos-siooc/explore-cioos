const test = require("node:test");
const assert = require("node:assert/strict");

const { metricJoin, metricValueExpr } = require("./hexMetric");

test("the days join is one unnest, never a UNION subquery the planner can memoize per row", () => {
  for (const table of ["profiles", "trajectory_hexes", "obis_cells"]) {
    const join = metricJoin(table, "days");
    assert.match(join, /^LEFT JOIN LATERAL unnest\(/);
    assert.doesNotMatch(join, /UNION/);
    assert.match(join, /\bmetric_days\(day\)/);
  }
});

test("the days join falls back to the time span only when day_ranges is empty", () => {
  const join = metricJoin("profiles", "days");
  assert.match(
    join,
    /WHEN coalesce\(array_length\(day_ranges, 1\), 0\) > 0 THEN day_ranges\s+WHEN time_min IS NOT NULL/,
  );
  assert.equal(
    metricValueExpr("profiles", "days"),
    "metric_days.day as metric_value",
  );
});

test("only the days metric joins anything", () => {
  assert.equal(metricJoin("profiles", "records"), "");
  assert.equal(metricJoin("profiles", "datasets"), "");
});
