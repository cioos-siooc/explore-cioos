const test = require("node:test");
const assert = require("node:assert/strict");

const createDBFilter = require("./dbFilter");

const {
  ScientificNameSelectionTooBroadError,
  InvalidPolygonError,
  MAX_EXPANDED_APHIA_IDS,
} = createDBFilter;

/*
 * createDBFilter is pure string assembly apart from the scientific-name
 * expansion, which is injected here — so every one of these runs with no
 * Postgres. The predicates are asserted through knex's .toString(), which
 * interpolates the bindings the Raw carries.
 */

test("no filters emits TRUE, not an empty predicate", async () => {
  const f = await createDBFilter({});
  assert.equal(f.shared.toString(), "TRUE");
  assert.equal(f.obisOnly.toString(), "TRUE");
  assert.equal(f.profileOnly.toString(), "TRUE");
  assert.equal(f.hasShared, false);
});

test("time and depth bounds are emitted as bounded, cast predicates", async () => {
  const f = await createDBFilter({
    timeMin: "2020-01-01",
    timeMax: "2021-01-01",
    depthMin: "0",
    depthMax: "100",
  });
  const sql = f.shared.toString();
  assert.match(sql, /time_max >= '2020-01-01'::timestamptz/);
  assert.match(sql, /time_min <= '2021-01-01'::timestamptz/);
  assert.match(sql, /depth_max >= \('0'\)::integer/);
  assert.match(sql, /depth_min <= \('100'\)::integer/);
  assert.equal(f.hasShared, true);
});

test("eovs is applied at BOTH dataset and feature level", async () => {
  // The feature-level copy is what makes a multi-EOV dataset contribute only
  // the casts that measured the selected variable; dropping either half is a
  // silent behaviour change with no error to catch it.
  const f = await createDBFilter({ eovs: "temperature,salinity" });
  assert.match(f.shared.toString(), /eovs && /);
  assert.match(f.profileOnly.toString(), /eovs && /);
});

test("comma-separated keys bind as arrays, not as the raw string", async () => {
  // pointPKs regressed exactly this way once: the query string was bound
  // whole, so `= ANY(:pointPKs)` could never match.
  const f = await createDBFilter({
    pointPKs: "1,2,3",
    datasetPKs: "a,b",
    organizations: "7",
  });
  const sql = f.shared.toString();
  // A postgres array literal, not the comma-separated string it arrived as —
  // `= ANY('1,2,3')` cannot be cast to an integer array and never matches.
  assert.match(sql, /point_pk = ANY \('\{"1","2","3"\}'\)/);
  assert.match(sql, /d\.pk_url = ANY \('\{"a","b"\}'\)/);
  assert.match(sql, /organization_pks && '\{"7"\}'/);
});

test("excludeDatasetPKs is the same narrowing written the shorter way", async () => {
  // A client that narrows the catalogue itself can name what it kept or what
  // it dropped; both have to reach the same predicate column, or the mild
  // narrowings that can only be sent as a drop list would filter nothing.
  const f = await createDBFilter({ excludeDatasetPKs: "4,5" });
  assert.match(f.shared.toString(), /d\.pk_url <> ALL \('\{"4","5"\}'\)/);
});

test("excluding datasets does not drop the ones with no pk_url yet", async () => {
  // pk_url is nullable, and `NULL <> ALL (...)` is NULL, not TRUE. Without the
  // guard a single exclusion silently drops every dataset that
  // 5_profile_process.sql has not back-filled — the opposite of narrowing.
  const f = await createDBFilter({ excludeDatasetPKs: "4" });
  assert.match(f.shared.toString(), /d\.pk_url IS NULL OR d\.pk_url <> ALL/);
});

test("exclude params drop what they name but keep rows where the column is NULL", async () => {
  // `NULL <> ALL (...)` and `NOT (NULL && ...)` are both NULL, so an unguarded
  // exclusion would also drop every dataset with no platform, organisation,
  // server or node — the opposite of "everything except X".
  const sql = (
    await createDBFilter({
      excludePlatforms: "mooring",
      excludeOrganizations: "7",
      excludeErddapServers: "https://a.example/erddap",
      excludeObisNodes: "Node A",
    })
  ).shared.toString();
  assert.match(
    sql,
    /\(platform IS NULL OR platform <> ALL\('\{"mooring"\}'\)\)/,
  );
  assert.match(sql, /NOT coalesce\(organization_pks && '\{"7"\}', false\)/);
  assert.match(
    sql,
    /\(d\.erddap_url IS NULL OR d\.erddap_url <> ALL\('\{"https:\/\/a\.example\/erddap"\}'\)\)/,
  );
  assert.match(sql, /NOT coalesce\(d\.obis_nodes && '\{"Node A"\}', false\)/);
});

test("an include and an exclude on the same filter are ANDed", async () => {
  const sql = (
    await createDBFilter({ platforms: "glider,argo", excludePlatforms: "argo" })
  ).shared.toString();
  assert.match(sql, /platform = any\('\{"glider","argo"\}'\) AND/);
  assert.match(sql, /platform <> ALL\('\{"argo"\}'\)/);
});

test("source excludes do not take part in the include OR", async () => {
  // The include pair is one OR'd predicate (the combined Data Source filter);
  // an exclusion must narrow on top of it, not become a third alternative.
  const sql = (
    await createDBFilter({
      obisNodes: "Node A",
      erddapServers: "https://a.example/erddap",
      excludeObisNodes: "Node B",
    })
  ).shared.toString();
  assert.match(sql, /\(d\.obis_nodes && .* OR d\.erddap_url = ANY/);
  assert.match(sql, /AND \nNOT coalesce\(d\.obis_nodes && '\{"Node B"\}'/);
});

test("eovsMatch=all asks for every EOV at both dataset and feature level", async () => {
  const all = await createDBFilter({
    eovs: "temperature,oxygen",
    eovsMatch: "all",
  });
  assert.match(all.shared.toString(), /eovs @> '\{"temperature","oxygen"\}'/);
  assert.match(
    all.profileOnly.toString(),
    /eovs @> '\{"temperature","oxygen"\}'/,
  );
  const any = await createDBFilter({ eovs: "temperature", eovsMatch: "any" });
  assert.match(any.shared.toString(), /eovs && /);
});

test("latitude is clamped to the Mercator-valid range", async () => {
  // Transforming a ±90° envelope throws "transform: tolerance condition
  // error" in PostGIS and 500s the request.
  const f = await createDBFilter({
    latMin: "-90",
    latMax: "90",
    lonMin: "-180",
    lonMax: "180",
  });
  const sql = f.shared.toString();
  assert.match(sql, /-85\.05/);
  assert.match(sql, /85\.05/);
  assert.doesNotMatch(sql, /\b-?90\b/);
});

test("a partial rectangle still filters, defaulting the missing bounds", async () => {
  const f = await createDBFilter({ lonMin: "-130" });
  const sql = f.shared.toString();
  assert.match(sql, /ST_MakeEnvelope/);
  assert.match(sql, /-130/);
  assert.match(sql, /180/);
});

test("an unparseable polygon is a 400, not a bound `false`", async () => {
  await assert.rejects(
    () => createDBFilter({ polygon: "not json" }),
    (err) => {
      assert.ok(err instanceof InvalidPolygonError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );
});

test("a valid polygon becomes an ST_Intersects against search_geom", async () => {
  // Ring whose two axes cannot be confused, matching polygon.test.js.
  const ring = JSON.stringify([
    [-130, 50],
    [-129, 50],
    [-129, 51],
    [-130, 50],
  ]);
  const f = await createDBFilter({ polygon: ring });
  assert.match(f.shared.toString(), /ST_Intersects\(search_geom/);
});

test("obisNodes and erddapServers OR together only when both are set", async () => {
  const both = await createDBFilter({
    obisNodes: "n1",
    erddapServers: "https://e",
  });
  assert.match(
    both.shared.toString(),
    /\(d\.obis_nodes && .* OR d\.erddap_url = ANY\(.*\)\)/,
  );

  const nodesOnly = await createDBFilter({ obisNodes: "n1" });
  assert.match(nodesOnly.shared.toString(), /^d\.obis_nodes && /);
  assert.doesNotMatch(nodesOnly.shared.toString(), /erddap_url/);

  const serversOnly = await createDBFilter({ erddapServers: "https://e" });
  assert.match(serversOnly.shared.toString(), /^d\.erddap_url = ANY\(/);
  assert.doesNotMatch(serversOnly.shared.toString(), /obis_nodes/);
});

test("excludeEovs drops at both levels and keeps datasets with no EOVs", async () => {
  const f = await createDBFilter({ excludeEovs: "salinity" });
  const clause = /NOT coalesce\(eovs && '\{"salinity"\}', false\)/;
  assert.match(f.shared.toString(), clause);
  assert.match(f.profileOnly.toString(), clause);
});

test("organizationsMatch=all asks for every organisation", async () => {
  const all = await createDBFilter({
    organizations: "1,2",
    organizationsMatch: "all",
  });
  assert.match(all.shared.toString(), /organization_pks @> '\{"1","2"\}'/);
  const any = await createDBFilter({ organizations: "1,2" });
  assert.match(any.shared.toString(), /organization_pks && '\{"1","2"\}'/);
});

test("scientificNamesMatch=all rolls each name down on its own and ANDs them", async () => {
  const askedFor = [];
  const f = await createDBFilter(
    {
      scientificNames: "Gadus morhua,Clupea harengus",
      scientificNamesMatch: "all",
    },
    {
      fetchAphiaIds: async (names) => {
        askedFor.push(names);
        return names[0] === "Gadus morhua" ? [126436] : [126417];
      },
    },
  );
  assert.deepEqual(askedFor, [["Gadus morhua"], ["Clupea harengus"]]);
  assert.match(
    f.obisOnly.toString(),
    /\(aphia_ids && '\{126436\}' OR scientific_names && '\{"Gadus morhua"\}'\) AND \n\(aphia_ids && '\{126417\}' OR scientific_names && '\{"Clupea harengus"\}'\)/,
  );
});

test("excludeScientificNames drops the rolled-down taxa from cells only", async () => {
  const f = await createDBFilter(
    { excludeScientificNames: "Gadus" },
    { fetchAphiaIds: async () => [125732, 126436] },
  );
  assert.equal(f.shared.toString(), "TRUE");
  assert.match(
    f.obisOnly.toString(),
    /NOT coalesce\(\(aphia_ids && '\{125732,126436\}' OR scientific_names && '\{"Gadus"\}'\), false\)/,
  );
});

test("scientificNames expands via the injected fetcher and filters OBIS only", async () => {
  let askedFor;
  const f = await createDBFilter(
    { scientificNames: "Gadus morhua, Gadus morhua ,Clupea harengus" },
    {
      fetchAphiaIds: async (names) => {
        askedFor = names;
        return [126436, 126417];
      },
    },
  );

  // De-duplicated and trimmed before it reaches the database.
  assert.deepEqual(askedFor, ["Gadus morhua", "Clupea harengus"]);
  // OBIS-only: the shared predicate must not carry a taxon filter, or it would
  // be applied to profiles that have no aphia_ids column.
  assert.equal(f.shared.toString(), "TRUE");
  const obis = f.obisOnly.toString();
  assert.match(obis, /aphia_ids && /);
  assert.match(obis, /126436/);
  assert.match(obis, /scientific_names && /);
});

test("non-integer aphia ids are dropped whatever supplied them", async () => {
  const f = await createDBFilter(
    { scientificNames: "Gadus morhua" },
    { fetchAphiaIds: async () => [126436, null, undefined, "126417"] },
  );
  const obis = f.obisOnly.toString();
  assert.match(obis, /126436/);
  assert.doesNotMatch(obis, /null/);
  assert.doesNotMatch(obis, /'126417'/);
});

test("an expansion past the cap is a 400 carrying the counts", async () => {
  const tooMany = Array.from(
    { length: MAX_EXPANDED_APHIA_IDS + 1 },
    (_, i) => i + 1,
  );
  await assert.rejects(
    () =>
      createDBFilter(
        { scientificNames: "Chordata" },
        { fetchAphiaIds: async () => tooMany },
      ),
    (err) => {
      assert.ok(err instanceof ScientificNameSelectionTooBroadError);
      assert.equal(err.statusCode, 400);
      assert.equal(err.expandedCount, MAX_EXPANDED_APHIA_IDS + 1);
      assert.equal(err.threshold, MAX_EXPANDED_APHIA_IDS);
      return true;
    },
  );
});

test("exactly at the cap is allowed", async () => {
  const atCap = Array.from({ length: MAX_EXPANDED_APHIA_IDS }, (_, i) => i + 1);
  const f = await createDBFilter(
    { scientificNames: "Gadidae" },
    { fetchAphiaIds: async () => atCap },
  );
  assert.match(f.obisOnly.toString(), /aphia_ids && /);
});

test("the fetcher is not called when no scientific name is selected", async () => {
  let called = false;
  await createDBFilter(
    { timeMin: "2020-01-01" },
    {
      fetchAphiaIds: async () => {
        called = true;
        return [];
      },
    },
  );
  assert.equal(called, false, "assembly must not touch the database");
});

test("realtimeOnly adds a dataset-level freshness predicate", async () => {
  const f = await createDBFilter({ realtimeOnly: "true" });
  const sql = f.shared.toString();
  // Qualified with `d.`, because the bare column names would be ambiguous
  // against the feature tables the branches union together.
  //
  // verified_at and not last_updated_at: last_updated_at only advances when the
  // dataset's content changed, so an incremental harvest that skips a dead feed
  // as unchanged freezes coverage_time_max and last_updated_at together and the
  // dataset reads realtime forever. verified_at advances on every harvest that
  // reached the dataset, so the gap widens and the flag expires on its own.
  assert.match(
    sql,
    /dataset_is_realtime\(d\.coverage_time_max, d\.verified_at, d\.cdm_data_type\)/,
  );
  // A plain boolean test, never `NOT dataset_is_realtime(...)`: the function is
  // IMMUTABLE over two stored columns and cannot return NULL, and a negation
  // over a three-valued result would drop rows from both sides of the facet.
  assert.doesNotMatch(sql, /NOT dataset_is_realtime/);
  assert.equal(f.hasShared, true);
});

test("realtimeOnly is dataset-level, so it stays out of the profile fragment", async () => {
  const f = await createDBFilter({ realtimeOnly: "true" });
  assert.doesNotMatch(f.profileOnly.toString(), /dataset_is_realtime/);
  assert.doesNotMatch(f.obisOnly.toString(), /dataset_is_realtime/);
});

test("realtimeOnly off or absent constrains nothing", async () => {
  for (const request of [{}, { realtimeOnly: "false" }]) {
    const f = await createDBFilter(request);
    assert.equal(f.shared.toString(), "TRUE");
    assert.equal(f.hasShared, false);
  }
});
