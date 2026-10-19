const test = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");

// dbFilter returns knex Raw fragments that routes bind into their own
// db.raw; each must be interpolated, with its nested bindings, by whichever
// knex instance runs the outer query. knex never connects until a query
// executes, so no Postgres is needed.

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

  // As in the shape query: :timeMin is in the outer SQL and in :filters.
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
