const test = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");

/*
 * Pins the contract that lets dbFilter keep returning knex Raw objects rather
 * than plain strings: a fragment is interpolated, with its own nested
 * bindings, by whichever knex instance executes the outer query.
 *
 * Six call sites depend on this — shapeQuery, griddapCoverage, tiles, legend,
 * download and timeExtent all bind `filters.shared` into their own db.raw.
 * Nothing else records it, and it is the reason TODO §P2.2's "pass the
 * database in" was judged unnecessary: a Raw is already independent of the
 * instance that made it.
 *
 * Both instances here are query-builder-only — knex does not connect until a
 * query executes, which is also why every other test in this directory can
 * assert real SQL with no Postgres running.
 */

const builderOnly = () => knex({ client: "pg" });

test("a Raw from one knex instance interpolates into another's query", () => {
  const a = builderOnly();
  const b = builderOnly();

  const fragment = a.raw("depth_max >= (:depthMin)::integer", {
    depthMin: "42",
  });
  const query = b.raw("SELECT * FROM cde.profiles WHERE :filters", {
    filters: fragment,
  });

  assert.equal(
    query.toString(),
    "SELECT * FROM cde.profiles WHERE depth_max >= ('42')::integer",
  );
});

test("nested bindings survive interpolation, including arrays", () => {
  const a = builderOnly();
  const b = builderOnly();

  const fragment = a.raw(
    "eovs && :eovs AND point_pk = ANY (:pointPKs) AND t >= :t::timestamptz",
    { eovs: ["temperature"], pointPKs: ["1", "2"], t: "2020-01-01" },
  );
  const sql = b
    .raw("SELECT 1 WHERE :filters", { filters: fragment })
    .toString();

  assert.match(sql, /eovs && '\{"temperature"\}'/);
  assert.match(sql, /point_pk = ANY \('\{"1","2"\}'\)/);
  assert.match(sql, /t >= '2020-01-01'::timestamptz/);
});

test("the outer query's own bindings coexist with the fragment's", () => {
  const a = builderOnly();
  const b = builderOnly();

  // The shape query does exactly this: :timeMin belongs to the outer SQL while
  // :filters carries its own copy of the same value.
  const fragment = a.raw("time_max >= :timeMin::timestamptz", {
    timeMin: "2020-01-01",
  });
  const sql = b
    .raw("SELECT :timeMin::date AS d WHERE :filters", {
      timeMin: "2020-01-01",
      filters: fragment,
    })
    .toString();

  assert.equal(
    sql,
    "SELECT '2020-01-01'::date AS d WHERE time_max >= '2020-01-01'::timestamptz",
  );
});

test("multiple fragments in one query stay independent", () => {
  const a = builderOnly();
  const b = builderOnly();

  const shared = a.raw("platform = any(:p)", { p: ["ship"] });
  const obis = a.raw("aphia_ids && :ids", { ids: [126436] });
  const sql = b
    .raw("SELECT 1 WHERE :filters AND (:obisFilters)", {
      filters: shared,
      obisFilters: obis,
    })
    .toString();

  assert.match(sql, /platform = any\('\{"ship"\}'\)/);
  assert.match(sql, /aphia_ids && '\{126436\}'/);
});
