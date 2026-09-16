const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const { FINE } = require("./hexTiers");

/*
 * The rules every route that reads a selection has to obey, checked against
 * the SQL they actually emit.
 *
 * utils/selection.test.js pins what the shared module says; this pins that the
 * routes still ask it. That is the half that failed before §P2.1: the gate and
 * the branch set were correct in one file and stale in the next, every copy
 * ran, and nothing anywhere compared them.
 *
 * No database is involved. `../db` is replaced in require.cache by a
 * builder-only knex whose .raw records the statement and hands back a Raw that
 * is not thenable, so each handler runs to completion and every statement is
 * captured fully interpolated. The handlers are pulled off the routers
 * directly, which skips the validate/cache stages (utils/routePipeline.test.js
 * covers those) and leaves only SQL assembly.
 */

const ROOT = path.join(__dirname, "..");
const knex = require("knex")({ client: "pg" });

const captured = [];

function fakeDb(...args) {
  return knex(...args);
}
fakeDb.raw = (sql, params) => {
  const raw = params === undefined ? knex.raw(sql) : knex.raw(sql, params);
  captured.push(raw);
  raw.then = (onFulfilled) => Promise.resolve({ rows: [{}] }).then(onFulfilled);
  return raw;
};

const dbPath = path.join(ROOT, "db.js");
const dbStub = new Module(dbPath, null);
dbStub.filename = dbPath;
dbStub.loaded = true;
dbStub.exports = fakeDb;
require.cache[dbPath] = dbStub;

// The aphia rolldown is the one query dbFilter runs; stub it so taxon
// selections need no Postgres either. Routes call createDBFilter without the
// injection seam, so the default is supplied here.
const dbFilterPath = require.resolve("./dbFilter");
const createDBFilter = require(dbFilterPath);
require.cache[dbFilterPath].exports = Object.assign(
  (query, opts = {}) =>
    createDBFilter(query, { fetchAphiaIds: async () => [126436], ...opts }),
  createDBFilter,
);

const { buildShapeSql } = require("./shapeQuery");

// Every route that reads a selection, and whether it draws the map. `params`
// is a mid-zoom tile so both hex tiers and both grid modes are reachable.
const MAP_ROUTES = ["tiles", "tiles/cells"];
const ROUTES = {
  tiles: { module: "../routes/tiles", path: "/:z/:x/:y.mvt" },
  "tiles/cells": { module: "../routes/tiles", path: "/cells/:z/:x/:y.mvt" },
  "tiles/tracks": { module: "../routes/tiles", path: "/tracks/:z/:x/:y.mvt" },
  legend: { module: "../routes/legend", path: "/" },
  timeExtent: { module: "../routes/timeExtent", path: "/" },
  download: { module: "../routes/download", path: "/" },
  griddapCoverage: { module: "../routes/griddapCoverage", path: "/" },
};

function handlerFor(name) {
  const { module: mod, path: routePath } = ROUTES[name];
  const layer = require(mod).stack.find(
    (l) => l.route && l.route.path === routePath,
  );
  assert.ok(layer, `no route ${routePath} in ${mod}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const noopRes = () => ({
  setHeader() {},
  status() {
    return this;
  },
  send() {
    return this;
  },
  json() {
    return this;
  },
});

// Runs one route and returns every statement it emitted, whitespace collapsed.
async function sqlFrom(name, query = {}) {
  captured.length = 0;
  const req = {
    query: { email: "a@b.c", ...query },
    params: { z: "6", x: "20", y: "20" },
  };
  await handlerFor(name)(req, noopRes(), () => {});
  return captured.map((raw) => raw.toString().replace(/\s+/g, " "));
}

// The selection routes' branch sets, as one string each.
async function shapeSql(query = {}, opts = {}) {
  const { sql, params } = await buildShapeSql(query, {
    fetchAphiaIds: async () => [126436],
    ...opts,
  });
  return knex.raw(sql, params).toString().replace(/\s+/g, " ");
}

const readsProfiles = (sql) => /FROM cde\.profiles/.test(sql);
const readsTrajectory = (sql) => /FROM cde\.trajectory_hexes/.test(sql);
const readsObis = (sql) => /FROM cde\.obis_cells/.test(sql);
// A branch present only as the shape of the empty result set is not in the
// selection — it is wrapped in a subquery that yields nothing.
const stripEmptyGuard = (sql) =>
  sql.replace(/SELECT \* FROM \(.*?\) empty_combined WHERE FALSE/g, "");

// ---------------------------------------------------------------------------

test("every route hides ERDDAP data for a taxon selection", async () => {
  // Only occurrence records carry taxa. /tiles/tracks answers 204 and
  // /griddapCoverage an empty collection, so neither emits a feature query at
  // all; the rest must drop their ERDDAP arms.
  const taxon = { scientificNames: "Gadus morhua" };

  for (const name of ["tiles", "tiles/cells", "legend", "timeExtent"]) {
    const sql = (await sqlFrom(name, taxon)).map(stripEmptyGuard).join(" ");
    assert.ok(!readsProfiles(sql), `${name} still reads cde.profiles`);
    assert.ok(!readsTrajectory(sql), `${name} still reads trajectory hexes`);
  }

  const shape = stripEmptyGuard(await shapeSql(taxon));
  assert.ok(!readsProfiles(shape) && !readsTrajectory(shape));

  // The two that answer without querying at all.
  assert.deepEqual(await sqlFrom("tiles/tracks", taxon), []);
  assert.deepEqual(await sqlFrom("griddapCoverage", taxon), []);
  // /download queues nothing, so it never reaches its own branch set — but the
  // estimate it is measured against must agree, which the shape query above is.
});

test("an obisNodes selection hides ERDDAP data unless erddapServers joins it", async () => {
  for (const name of ["tiles", "tiles/cells", "legend", "timeExtent"]) {
    const nodesOnly = (await sqlFrom(name, { obisNodes: "n1" }))
      .map(stripEmptyGuard)
      .join(" ");
    assert.ok(!readsTrajectory(nodesOnly), `${name}: nodes-only kept ERDDAP`);

    const combined = (
      await sqlFrom(name, { obisNodes: "n1", erddapServers: "https://e" })
    )
      .map(stripEmptyGuard)
      .join(" ");
    assert.ok(readsTrajectory(combined), `${name}: combined dropped ERDDAP`);
  }
});

test("includeObis=false drops the OBIS arm from every route that has one", async () => {
  for (const name of ["tiles", "tiles/cells", "legend", "timeExtent"]) {
    const sql = (await sqlFrom(name, { includeObis: "false" }))
      .map(stripEmptyGuard)
      .join(" ");
    assert.ok(!readsObis(sql), `${name} still reads cde.obis_cells`);
  }
  assert.ok(
    !readsObis(stripEmptyGuard(await shapeSql({ includeObis: "false" }))),
  );
});

test("only the map routes restrict profiles to drawable features", async () => {
  // show_as_point says whether a feature can be drawn, not whether it is
  // selected. A route on the wrong side of that line computes its answer over
  // a different feature set than the ones it is displayed beside.
  // Asserted per statement, not over a route's statements joined together: a
  // route emits several, and one of them satisfying the rule says nothing
  // about the others.
  for (const name of MAP_ROUTES.concat("legend")) {
    for (const sql of (await sqlFrom(name)).filter(readsProfiles)) {
      assert.match(sql, /show_as_point/, `${name} must gate on show_as_point`);
    }
  }
  for (const name of ["timeExtent", "download"]) {
    const sql = (await sqlFrom(name)).join(" ");
    assert.doesNotMatch(
      sql,
      /show_as_point/,
      `${name} must not gate on show_as_point`,
    );
  }
  assert.doesNotMatch(await shapeSql(), /show_as_point/);
});

test("every branch reading cde.profiles binds the feature-level EOV filter", async () => {
  // dbFilter's profileOnly fragment is what makes a multi-EOV dataset
  // contribute only the casts that measured the selected variable. A branch
  // that omits it silently falls back to dataset-level EOVs, with no error.
  const query = { eovs: "temperature" };
  const statements = [
    ...(await sqlFrom("tiles", query)),
    ...(await sqlFrom("legend", query)),
    ...(await sqlFrom("timeExtent", query)),
    ...(await sqlFrom("download", query)),
    await shapeSql(query),
  ].filter(readsProfiles);

  assert.ok(statements.length >= 5, "expected a profiles branch per route");
  for (const sql of statements) {
    // The fragment is interpolated by the time it is captured, so look for the
    // predicate itself rather than the binding name.
    const profilesBranch = sql.slice(sql.indexOf("FROM cde.profiles"));
    assert.match(
      profilesBranch.slice(0, 400),
      /eovs && /,
      `a profiles branch omits the feature-level EOV filter: ${profilesBranch.slice(0, 160)}`,
    );
  }
});

test("outside the map, trajectory coverage is read at one tier only", async () => {
  // Coverage rows exist at both tiers describing the same data, so anything
  // counting a trajectory once has to pin a tier. The tile routes pick theirs
  // from the zoom instead, and /legend's hex query deliberately reads both —
  // it splits them into the two zoom buckets it ramps separately.
  for (const name of ["timeExtent", "download"]) {
    const statements = (await sqlFrom(name)).filter(readsTrajectory);
    assert.ok(statements.length, `${name} emitted no trajectory branch`);
    // Per statement: /download emits its own branch set AND the shape query's,
    // and one of them obeying the rule says nothing about the other.
    for (const sql of statements) {
      assert.match(sql, new RegExp(`hex_tier = ${FINE.tier}\\b`), name);
      assert.match(sql, new RegExp(`JOIN ${FINE.hexesTable} h`), name);
      assert.doesNotMatch(
        sql,
        new RegExp(`hex_tier = (?!${FINE.tier}\\b)\\d`),
        `${name} reads a second tier`,
      );
    }
  }
  assert.match(await shapeSql(), new RegExp(`t\\.hex_tier = ${FINE.tier}\\b`));
});

test("a selection containing no source still yields runnable SQL", async () => {
  // Every arm suppressed at once must produce a WHERE FALSE shell, not an
  // empty UNION — and the shell has to carry the enclosing CTE's own columns.
  const nothing = {
    scientificNames: "Gadus morhua",
    includeObis: "false",
    includeTrajectory: "false",
    profileTypes: "",
  };
  for (const name of ["tiles", "tiles/cells", "legend", "timeExtent"]) {
    const sql = (await sqlFrom(name, nothing)).join(" ");
    assert.match(sql, /empty_combined WHERE FALSE/, name);
    assert.doesNotMatch(sql, /UNION ALL\s*\)/, `${name} left a dangling UNION`);
  }
  assert.match(await shapeSql(nothing), /empty_combined WHERE FALSE/);
});
