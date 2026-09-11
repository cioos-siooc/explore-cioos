const test = require("node:test");
const assert = require("node:assert/strict");

const {
  erddapVisible,
  obisVisible,
  DRAWN_AS_POINT,
  TRAJECTORY_COVERAGE_FROM,
  GRIDDAP_TIME_DEPTH_COLUMNS,
  GRIDDAP_FROM,
  unionBranches,
} = require("./selection");
const { FINE } = require("./hexTiers");

/*
 * The gates below were copied across eight and six call sites respectively
 * before this module existed, and the copies drifted. These pin the truth
 * table; utils/selectionAgreement.test.js checks that every route still asks
 * this module rather than answering for itself.
 */

test("a plain selection contains both ERDDAP and OBIS data", () => {
  assert.equal(erddapVisible({}), true);
  assert.equal(obisVisible({}), true);
});

test("a scientific-name selection is OBIS-only", () => {
  // Only occurrence records carry taxa, so a taxon filter cannot be answered
  // by any ERDDAP source — including alongside a server selection.
  assert.equal(erddapVisible({ scientificNames: "Gadus morhua" }), false);
  assert.equal(
    erddapVisible({
      scientificNames: "Gadus morhua",
      erddapServers: "https://e",
    }),
    false,
  );
});

test("an obisNodes selection is OBIS-only unless erddapServers joins it", () => {
  // The pair is the frontend's combined Data Source filter, which dbFilter
  // turns into one OR'd dataset predicate — both feature sets have to be
  // present for that OR to select anything.
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
  // Anything else, including an absent param from an older client, is "on".
  assert.equal(obisVisible({ includeObis: "" }), true);
});

test("the trajectory row set pins one tier and joins its polygon", () => {
  // Coverage exists at both tiers describing the same data; reading both
  // double-counts. The polygon (not the centroid) is what the spatial filter
  // matches, so a selection smaller than a hex still finds what is inside it.
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
  // dbFilter's predicates are unqualified, so a griddap row set missing one of
  // these names makes the whole statement fail to parse.
  for (const name of ["time_min", "time_max", "depth_min", "depth_max"]) {
    assert.match(GRIDDAP_TIME_DEPTH_COLUMNS, new RegExp(`AS ${name}\\b`));
  }
  // A timeless grid must match any time filter rather than none.
  assert.match(GRIDDAP_TIME_DEPTH_COLUMNS, /'-infinity'::timestamptz/);
  assert.match(GRIDDAP_TIME_DEPTH_COLUMNS, /'infinity'::timestamptz/);
  // Both the aliases and the row set are written against the same alias.
  assert.match(GRIDDAP_FROM, /FROM cde\.datasets d\b/);
  assert.match(GRIDDAP_FROM, /d\.cdm_data_type = 'Grid'/);
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
  // Every branch carries a WHERE of its own, so `${branch} WHERE FALSE` is a
  // syntax error — and a hand-written NULL shell has to be kept in step with
  // the branch's column names and types by hand.
  const branch = "SELECT a, b FROM t WHERE :filters";
  const sql = unionBranches([], branch);
  assert.equal(sql, `SELECT * FROM (${branch}) empty_combined WHERE FALSE`);
  assert.doesNotMatch(sql, /UNION/);
});
