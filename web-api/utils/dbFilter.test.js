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
  assert.equal(f.hasObisOnly, false);
  assert.equal(f.hasProfileOnly, false);
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
  assert.equal(f.hasProfileOnly, true);
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
  assert.equal(f.hasObisOnly, true);
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
