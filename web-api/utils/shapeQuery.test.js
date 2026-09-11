const test = require("node:test");
const assert = require("node:assert/strict");

const { buildShapeSql } = require("./shapeQuery");
const { FINE } = require("./hexTiers");

/*
 * The shape query is the largest SQL contract in the service and feeds
 * /datasetRecordsList, /pointQuery and /downloadEstimate. buildShapeSql
 * assembles it without executing, so which branches a selection produces can
 * be asserted with no Postgres.
 *
 * Branch fingerprints — each is a string unique to one arm of the UNION.
 */
const PROFILES = /FROM cde\.profiles/;
const TRAJECTORY = /FROM cde\.trajectory_hexes/;
const OBIS = /FROM cde\.obis_cells/;
const GRIDDAP = /coverage_bbox AS search_geom/;

const build = (query, opts) => buildShapeSql(query, opts);

test("the default selection unions profiles, trajectory and obis", async () => {
  const { sql } = await build({});
  assert.match(sql, PROFILES);
  assert.match(sql, TRAJECTORY);
  assert.match(sql, OBIS);
  // Grids are metadata-only and never appear in the estimate path.
  assert.doesNotMatch(sql, GRIDDAP);
});

test("grids join the union only when not estimating", async () => {
  const { sql } = await build({}, { doEstimate: false });
  assert.match(sql, GRIDDAP);
});

test("includeObis=false drops the obis arm and nothing else", async () => {
  const { sql } = await build({ includeObis: "false" });
  assert.doesNotMatch(sql, OBIS);
  assert.match(sql, PROFILES);
  assert.match(sql, TRAJECTORY);
});

test("a scientific-name selection is OBIS-only: profiles and trajectory drop out", async () => {
  const { sql } = await build(
    { scientificNames: "Gadus morhua" },
    { fetchAphiaIds: async () => [126436] },
  );
  assert.doesNotMatch(sql, PROFILES);
  assert.doesNotMatch(sql, TRAJECTORY);
  assert.match(sql, OBIS);
});

test("an obisNodes selection hides profiles unless erddapServers is set alongside", async () => {
  const nodesOnly = await build({ obisNodes: "n1" });
  assert.doesNotMatch(nodesOnly.sql, PROFILES);
  assert.match(nodesOnly.sql, OBIS);

  // Combined Source filter: both are OR'd in the shared dataset filter, so
  // both feature sets have to be present for that OR to mean anything.
  const combined = await build({ obisNodes: "n1", erddapServers: "https://e" });
  assert.match(combined.sql, PROFILES);
  assert.match(combined.sql, TRAJECTORY);
  assert.match(combined.sql, OBIS);
});

test("an empty branch set still yields runnable SQL that matches nothing", async () => {
  // Every arm suppressed at once: the guard must emit a WHERE FALSE shell, not
  // an empty UNION that fails to parse.
  const { sql } = await build(
    { scientificNames: "Gadus morhua", includeObis: "false" },
    { fetchAphiaIds: async () => [126436] },
  );
  assert.match(sql, /empty_combined WHERE FALSE/);
});

test("getRecordsList toggles the records CTE and its join together", async () => {
  const withList = await build({});
  assert.match(withList.sql, /records AS \(/);
  assert.match(withList.sql, /LEFT JOIN records ON records\.dataset_pk/);
  assert.match(withList.sql, /coalesce\(records\.profiles, '\[\]'::json\)/);

  const without = await build({}, { getRecordsList: false });
  assert.doesNotMatch(without.sql, /records AS \(/);
  assert.doesNotMatch(without.sql, /LEFT JOIN records/);
  assert.doesNotMatch(without.sql, /records\.profiles/);
});

test("doEstimate toggles the size estimate and its bindings together", async () => {
  const est = await build({
    timeMin: "2020-01-01",
    timeMax: "2021-01-01",
    depthMin: "0",
    depthMax: "100",
  });
  assert.match(est.sql, /AS records_count/);
  assert.match(est.sql, /records_count \* num_columns \* :multiplier/);
  assert.deepEqual(Object.keys(est.params).sort(), [
    "adder",
    "depthMax",
    "depthMin",
    "filters",
    "multiplier",
    "obisFilters",
    "profileFilters",
    "timeMax",
    "timeMin",
  ]);

  const plain = await build({}, { doEstimate: false });
  assert.doesNotMatch(plain.sql, /records_count/);
  // The estimate's bindings must not linger: knex rejects a named binding the
  // SQL does not reference.
  assert.deepEqual(Object.keys(plain.params).sort(), [
    "filters",
    "obisFilters",
    "profileFilters",
  ]);
});

test("the estimate is a day-set overlap, not an elapsed span", async () => {
  // records_per_day is a rate over days WITH DATA, so pairing it with an
  // elapsed span over-counts a seasonal station by span/days-with-data.
  const { sql } = await build({ timeMin: "2020-01-01", timeMax: "2021-01-01" });
  assert.match(sql, /day_range_overlap_days\(p\.day_ranges/);
  // The span remains the fallback for features harvested before day sets.
  assert.match(sql, /range_intersection_length\(tstzrange/);
});

test("the three filter fragments are passed as bindings, not inlined", async () => {
  const { sql, params } = await build({ timeMin: "2020-01-01" });
  assert.match(sql, /WHERE {2}:filters/);
  assert.match(sql, /WHERE :profileFilters/);
  assert.match(sql, /WHERE :obisFilters/);
  for (const key of ["filters", "obisFilters", "profileFilters"]) {
    assert.equal(
      typeof params[key].toString,
      "function",
      `${key} must be a knex Raw carrying its own bindings`,
    );
  }
  assert.match(params.filters.toString(), /time_max >= '2020-01-01'/);
});

test("record collapsing stamps its extents in UTC", async () => {
  // Left to json_agg these would carry whatever offset the session's timezone
  // happens to be.
  const { sql } = await build({});
  assert.match(sql, /AT TIME ZONE 'UTC'/);
});

/*
 * These two were characterisation tests pinning the drift
 * TODO-cde-revisions.md §P2.1 recorded. §P2.1 resolved it, so they now assert
 * the agreed contract rather than merely recording what the code happened to
 * do. utils/selectionAgreement.test.js checks the other routes against the
 * same two rules.
 */
test("the profiles arm does NOT filter on show_as_point", async () => {
  // show_as_point decides whether the MAP can draw a feature, not whether the
  // selection contains it — a region-spanning feature is still listed, still
  // estimated and still downloadable. Only the tile and legend routes apply
  // it; /timeExtent used to as well, which computed the time axis over a
  // different feature set than the list that axis bounds.
  const { sql } = await build({});
  assert.doesNotMatch(sql, /show_as_point/);
});

test("the trajectory arm is pinned to one tier", async () => {
  // Coverage rows exist at both tiers describing the same data, so reading
  // both would double-count every estimate. Which tier is FINE's, from
  // utils/hexTiers.js — the one place that answers it.
  const { sql } = await build({});
  assert.match(sql, new RegExp(`t\\.hex_tier = ${FINE.tier}\\b`));
  assert.match(sql, new RegExp(`JOIN ${FINE.hexesTable} h`));
});
