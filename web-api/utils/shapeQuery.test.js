const test = require("node:test");
const assert = require("node:assert/strict");

const { buildShapeSql } = require("./shapeQuery");
const { FINE } = require("./hexTiers");

// Branch fingerprints: each is a string unique to one arm of the UNION.
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

  const combined = await build({ obisNodes: "n1", erddapServers: "https://e" });
  assert.match(combined.sql, PROFILES);
  assert.match(combined.sql, TRAJECTORY);
  assert.match(combined.sql, OBIS);
});

test("rows carry their OBIS nodes so the list can group by data portal", async () => {
  const { sql } = await build({});
  assert.match(sql, /d\.obis_nodes,/);
});

test("an empty branch set still yields runnable SQL that matches nothing", async () => {
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
  assert.match(
    est.sql,
    /records_count \* CASE WHEN source_type = 'obis' THEN :obisColumns ELSE num_columns END \* :multiplier/,
  );
  assert.deepEqual(Object.keys(est.params).sort(), [
    "adder",
    "depthMax",
    "depthMin",
    "depthVariableProbe",
    "filters",
    "multiplier",
    "obisColumns",
    "obisFilters",
    "profileFilters",
    "timeMax",
    "timeMin",
  ]);

  const plain = await build({}, { doEstimate: false });
  assert.doesNotMatch(plain.sql, /records_count/);
  // knex rejects a named binding the SQL does not reference.
  assert.deepEqual(Object.keys(plain.params).sort(), [
    "depthVariableProbe",
    "filters",
    "obisFilters",
    "profileFilters",
    "timeMax",
    "timeMin",
  ]);
});

test("the estimate is a day-set overlap, not an elapsed span", async () => {
  const { sql } = await build({ timeMin: "2020-01-01", timeMax: "2021-01-01" });
  assert.match(sql, /day_range_overlap_days\(p\.day_ranges/);
  assert.match(sql, /range_intersection_length\(tstzrange/);
});

test("the obis arm derives records_per_day from its occurrence count, not a zero", async () => {
  const { sql } = await build({});
  const from = sql.indexOf("FROM cde.obis_cells");
  const obisArm = sql.slice(sql.lastIndexOf("SELECT", from), from);
  assert.match(
    obisArm,
    /n_records::float \/ GREATEST\(CASE WHEN coalesce\(array_length\(day_ranges, 1\), 0\) > 0 THEN days ELSE date_part\('days', time_max - time_min\) END, 1\) AS records_per_day/,
  );
  assert.doesNotMatch(obisArm, /\b0 as records_per_day/i);
});

test("OBIS sizes take the downloader CSV width, since OBIS datasets carry no num_columns", async () => {
  const est = await build({});
  assert.match(
    est.sql,
    /records_count \* CASE WHEN source_type = 'obis' THEN :obisColumns ELSE num_columns END \* :multiplier/,
  );
  assert.equal(est.params.obisColumns, 8);
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
  const { sql } = await build({});
  assert.match(sql, /AT TIME ZONE 'UTC'/);
});

test("the profiles arm does NOT filter on show_as_point", async () => {
  // A region-spanning feature is still listed, estimated and downloadable;
  // only the tile and legend routes drop it.
  const { sql } = await build({});
  assert.doesNotMatch(sql, /show_as_point/);
});

test("the trajectory arm is pinned to one tier", async () => {
  // Both tiers hold the same data; reading both double-counts.
  const { sql } = await build({});
  assert.match(sql, new RegExp(`t\\.hex_tier = ${FINE.tier}\\b`));
  assert.match(sql, new RegExp(`JOIN ${FINE.hexesTable} h`));
});

test("the dataset payload carries the freshness fields the frontend reads", async () => {
  // The UI reads these off /pointQuery; dropping one fails with no
  // server-side error.
  const { sql } = await build({});
  assert.match(sql, /AS coverage_time_max/);
  assert.match(sql, /AS is_realtime/);
  // Parsed by the browser as strings.
  assert.match(sql, /to_char\(d\.coverage_time_max AT TIME ZONE 'UTC'/);
});

test("has_depth is projected, and its probe is bound rather than inlined", async () => {
  const { sql, params } = await build({}, { doEstimate: false });
  assert.match(sql, /AS has_depth/);
  assert.match(sql, /table_variables @> :depthVariableProbe::jsonb/);
  assert.deepEqual(JSON.parse(params.depthVariableProbe), [{ name: "depth" }]);
  assert.doesNotMatch(sql, /@> '\[/);
});

test("the datasets list reads days from the stored day set, clipped to the time filter", async () => {
  const list = await build({}, { doEstimate: false, getRecordsList: false });
  assert.match(
    list.sql,
    /day_range_overlap_days\(d\.day_ranges,\s+daterange\(:timeMin::date/,
  );
  assert.doesNotMatch(list.sql, /day_union_days/);

  const estimate = await build({}, { doEstimate: true, getRecordsList: false });
  assert.doesNotMatch(estimate.sql, /AS days/);
});

test("features are aggregated per dataset_pk before the dataset metadata joins in", async () => {
  // Grouping on d.pk sorted every matched feature to disk: 8-9.8 s -> 2.2 s.
  for (const opts of [
    { doEstimate: false, getRecordsList: false },
    { doEstimate: true, getRecordsList: false },
  ]) {
    const { sql } = await build({}, opts);
    assert.match(sql, /FROM {5}filtered p\s+GROUP BY p\.dataset_pk\)/);
    assert.doesNotMatch(sql, /GROUP BY d\.pk/);
  }
});

test("pksOnly selects pk_url over the same union and filters as the full query", async () => {
  const query = { latMin: "48", latMax: "49", lonMin: "-124", lonMax: "-123" };
  const full = await build(query, { doEstimate: false });
  const pks = await build(query, { doEstimate: false, pksOnly: true });

  assert.match(pks.sql, /SELECT DISTINCT d\.pk_url AS pk/);
  for (const branch of [PROFILES, TRAJECTORY, OBIS, GRIDDAP]) {
    assert.match(pks.sql, branch);
  }
  assert.doesNotMatch(pks.sql, /ST_Extent|per_dataset/);
  assert.deepEqual(Object.keys(pks.params).sort(), [
    "filters",
    "obisFilters",
    "profileFilters",
  ]);
  assert.equal(pks.params.filters.toString(), full.params.filters.toString());
});
