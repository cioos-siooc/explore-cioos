const test = require("node:test");
const assert = require("node:assert/strict");

const {
  erddapVisible,
  obisVisible,
  DRAWN_AS_POINT,
  TRAJECTORY_COVERAGE_FROM,
  GRIDDAP_TIME_DEPTH_COLUMNS,
  GRIDDAP_EXACT_TIME_DEPTH_COLUMNS,
  GRIDDAP_FROM,
  unionBranches,
} = require("./selection");
const { FINE } = require("./hexTiers");

// The truth table; utils/selectionAgreement.test.js checks routes ask it.

test("a plain selection contains both ERDDAP and OBIS data", () => {
  assert.equal(erddapVisible({}), true);
  assert.equal(obisVisible({}), true);
});

test("a scientific-name selection is OBIS-only", () => {
  // Taxa are OBIS-only, even alongside a server selection.
  assert.equal(erddapVisible({ scientificNames: "Gadus morhua" }), false);
  assert.equal(
    erddapVisible({
      scientificNames: "Gadus morhua",
      erddapServers: "https://e",
    }),
    false,
  );
});

test("excluding a taxon keeps ERDDAP, which carries none to exclude", () => {
  assert.equal(erddapVisible({ excludeScientificNames: "Gadus morhua" }), true);
});

test("an obisNodes selection is OBIS-only unless erddapServers joins it", () => {
  assert.equal(erddapVisible({ obisNodes: "n1" }), false);
  assert.equal(
    erddapVisible({ obisNodes: "n1", erddapServers: "https://e" }),
    true,
  );
  assert.equal(erddapVisible({ erddapServers: "https://e" }), true);
});

test("only an explicit includeObis=false hides occurrence cells", () => {
  assert.equal(obisVisible({ includeObis: "false" }), false);
  assert.equal(obisVisible({ includeObis: "true" }), true);
  // Absent (older clients) means on.
  assert.equal(obisVisible({ includeObis: "" }), true);
});

test("the trajectory row set pins one tier and joins its polygon", () => {
  assert.match(
    TRAJECTORY_COVERAGE_FROM,
    new RegExp(`WHERE t\\.hex_tier = ${FINE.tier}$`),
  );
  assert.match(
    TRAJECTORY_COVERAGE_FROM,
    new RegExp(`JOIN ${FINE.hexesTable} h ON h\\.pk = t\\.hex_pk`),
  );
});

test("the griddap row set aliases coverage_* to the names dbFilter uses", () => {
  for (const name of ["time_min", "time_max", "depth_min", "depth_max"]) {
    assert.match(GRIDDAP_TIME_DEPTH_COLUMNS, new RegExp(`AS ${name}\\b`));
  }
  assert.match(GRIDDAP_TIME_DEPTH_COLUMNS, /'-infinity'::timestamptz/);
  assert.match(GRIDDAP_TIME_DEPTH_COLUMNS, /'infinity'::timestamptz/);
  assert.match(GRIDDAP_FROM, /FROM cde\.datasets d\b/);
  assert.match(GRIDDAP_FROM, /d\.cdm_data_type = 'Grid'/);
});

test("the exact griddap row set keeps the aliases but not the time coalesce", () => {
  for (const name of ["time_min", "time_max", "depth_min", "depth_max"]) {
    assert.match(GRIDDAP_EXACT_TIME_DEPTH_COLUMNS, new RegExp(`AS ${name}\\b`));
  }
  assert.doesNotMatch(GRIDDAP_EXACT_TIME_DEPTH_COLUMNS, /infinity/);
  assert.match(
    GRIDDAP_EXACT_TIME_DEPTH_COLUMNS,
    /d\.coverage_time_min AS time_min/,
  );
  assert.match(
    GRIDDAP_EXACT_TIME_DEPTH_COLUMNS,
    /d\.coverage_time_max AS time_max/,
  );
  // A depthless grid is at the surface, not nowhere.
  assert.match(
    GRIDDAP_EXACT_TIME_DEPTH_COLUMNS,
    /coalesce\(d\.coverage_depth_min, 0\)/,
  );
});

test("show_as_point is named, not spelled out, so its absence is legible", () => {
  assert.equal(DRAWN_AS_POINT, "show_as_point");
});

test("unionBranches joins the arms it is given, in order", () => {
  const sql = unionBranches(["SELECT 1", "SELECT 2", "SELECT 3"], "SELECT 1");
  assert.match(sql, /SELECT 1\s+UNION ALL\s+SELECT 2\s+UNION ALL\s+SELECT 3/);
});

test("a single branch is emitted with no UNION at all", () => {
  assert.equal(unionBranches(["SELECT 1"], "SELECT 1"), "SELECT 1");
});

test("an empty selection wraps a real branch rather than an empty UNION", () => {
  const branch = "SELECT a, b FROM t WHERE :filters";
  const sql = unionBranches([], branch);
  assert.equal(sql, `SELECT * FROM (${branch}) empty_combined WHERE FALSE`);
  assert.doesNotMatch(sql, /UNION/);
});
