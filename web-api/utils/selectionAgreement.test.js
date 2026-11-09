const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const { FINE } = require("./hexTiers");

// utils/selection.test.js pins what the shared module says; this pins that
// every route still asks it, against the SQL they emit. `../db` is replaced by
// a builder-only knex whose .raw is not thenable, so handlers run to
// completion with no database.

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

// Routes call createDBFilter without the injection seam, so the default is
// supplied here.
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
  coverageHistogram: { module: "../routes/coverageHistogram", path: "/" },
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

async function sqlFrom(name, query = {}) {
  captured.length = 0;
  const req = {
    query,
    body: { email: "a@b.c" },
    params: { z: "6", x: "20", y: "20" },
  };
  await handlerFor(name)(req, noopRes(), () => {});
  return captured.map((raw) => raw.toString().replace(/\s+/g, " "));
}

async function shapeSql(query = {}, opts = {}) {
  const { sql, params } = await buildShapeSql(query, {
    fetchAphiaIds: async () => [126436],
    ...opts,
  });
  return knex.raw(sql, params).toString().replace(/\s+/g, " ");
}

// A source is also read through cde.hexes_zoom_0_rollup, by its `source` key.
const readsProfiles = (sql) =>
  /FROM cde\.profiles|source = 'profiles'/.test(sql);
const readsTrajectory = (sql) =>
  /FROM cde\.trajectory_hexes|source = 'trajectory'/.test(sql);
const readsObis = (sql) => /FROM cde\.obis_cells|source = 'obis'/.test(sql);
// The empty-result guard wraps a branch that yields nothing.
const stripEmptyGuard = (sql) =>
  sql.replace(/SELECT \* FROM \(.*?\) empty_combined WHERE FALSE/g, "");

test("every route hides ERDDAP data for a taxon selection", async () => {
  // /tiles/tracks and /griddapCoverage answer without a feature query.
  const taxon = { scientificNames: "Gadus morhua" };

  for (const name of [
    "tiles",
    "tiles/cells",
    "legend",
    "timeExtent",
    "coverageHistogram",
  ]) {
    const sql = (await sqlFrom(name, taxon)).map(stripEmptyGuard).join(" ");
    assert.ok(!readsProfiles(sql), `${name} still reads cde.profiles`);
    assert.ok(!readsTrajectory(sql), `${name} still reads trajectory hexes`);
  }

  const shape = stripEmptyGuard(await shapeSql(taxon));
  assert.ok(!readsProfiles(shape) && !readsTrajectory(shape));

  assert.deepEqual(await sqlFrom("tiles/tracks", taxon), []);
  assert.deepEqual(await sqlFrom("griddapCoverage", taxon), []);
  // /download queues nothing for this selection; the shape query above is
  // the estimate it must agree with.
});

test("an obisNodes selection hides ERDDAP data unless erddapServers joins it", async () => {
  for (const name of [
    "tiles",
    "tiles/cells",
    "legend",
    "timeExtent",
    "coverageHistogram",
  ]) {
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
  for (const name of [
    "tiles",
    "tiles/cells",
    "legend",
    "timeExtent",
    "coverageHistogram",
  ]) {
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
  // show_as_point is whether a feature can be drawn, not whether it is
  // selected. Asserted per statement: one statement obeying says nothing
  // about a route's others.
  for (const name of MAP_ROUTES.concat("legend")) {
    for (const sql of (await sqlFrom(name)).filter(readsProfiles)) {
      assert.match(sql, /show_as_point/, `${name} must gate on show_as_point`);
    }
  }
  for (const name of ["timeExtent", "download", "coverageHistogram"]) {
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
  // A branch omitting profileOnly silently falls back to dataset-level EOVs.
  // Both match modes and the exclusion ride in the same fragment.
  for (const [query, operator] of [
    [{ eovs: "temperature" }, /eovs && /],
    [{ eovs: "temperature,oxygen", eovsMatch: "all" }, /eovs @> /],
    [{ excludeEovs: "salinity" }, /NOT coalesce\(eovs && /],
  ]) {
    const statements = [
      ...(await sqlFrom("tiles", query)),
      ...(await sqlFrom("legend", query)),
      ...(await sqlFrom("timeExtent", query)),
      ...(await sqlFrom("download", query)),
      ...(await sqlFrom("coverageHistogram", query)),
      await shapeSql(query),
    ].filter(readsProfiles);

    assert.ok(statements.length >= 5, "expected a profiles branch per route");
    for (const sql of statements) {
      // Interpolated by capture time, so match the predicate, not the binding.
      const profilesBranch = sql.slice(sql.indexOf("FROM cde.profiles"));
      assert.match(
        profilesBranch.slice(0, 400),
        operator,
        `a profiles branch omits the feature-level EOV filter: ${profilesBranch.slice(0, 160)}`,
      );
    }
  }
});

test("outside the map, trajectory coverage is read at one tier only", async () => {
  // Both tiers hold the same data. Tile routes pick theirs from the zoom, and
  // /legend deliberately reads both to ramp the two zoom buckets separately.
  for (const name of ["timeExtent", "download", "coverageHistogram"]) {
    const statements = (await sqlFrom(name)).filter(readsTrajectory);
    assert.ok(statements.length, `${name} emitted no trajectory branch`);
    // Per statement: /download emits its own branch set AND the shape query's.
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
  // A WHERE FALSE shell carrying the enclosing CTE's columns, not an empty
  // UNION.
  const nothing = {
    scientificNames: "Gadus morhua",
    includeObis: "false",
    includeTrajectory: "false",
    profileTypes: "",
  };
  for (const name of [
    "tiles",
    "tiles/cells",
    "legend",
    "timeExtent",
    "coverageHistogram",
  ]) {
    const sql = (await sqlFrom(name, nothing)).join(" ");
    assert.match(sql, /empty_combined WHERE FALSE/, name);
    assert.doesNotMatch(sql, /UNION ALL\s*\)/, `${name} left a dangling UNION`);
  }
  assert.match(await shapeSql(nothing), /empty_combined WHERE FALSE/);
});

test("every selection route inherits the realtimeOnly and search dataset filters", async () => {
  // Catches a site that builds its own WHERE and forgets the shared fragment.
  const query = { realtimeOnly: "true", search: "salinity" };
  const statements = [
    ...(await sqlFrom("tiles", query)),
    ...(await sqlFrom("tiles/cells", query)),
    ...(await sqlFrom("legend", query)),
    ...(await sqlFrom("timeExtent", query)),
    ...(await sqlFrom("download", query)),
    ...(await sqlFrom("griddapCoverage", query)),
    await shapeSql(query),
    // Skip dbFilter's own fragments (e.g. the bare "TRUE").
  ].filter((sql) => /FROM cde\./.test(sql));

  assert.ok(
    statements.length >= 6,
    "expected at least one statement per route",
  );
  for (const sql of statements) {
    assert.match(
      sql,
      /dataset_is_realtime\(/,
      `a selection statement omits the realtime filter: ${sql.slice(0, 160)}`,
    );
    assert.match(
      sql,
      /d\.search_tsv @@ dataset_search_query\('salinity'\)/,
      `a selection statement omits the search filter: ${sql.slice(0, 160)}`,
    );
  }
});

test("every selection route inherits the exclude filters and match modes", async () => {
  // One param per predicate shape is enough.
  const query = {
    excludePlatforms: "mooring",
    excludeObisNodes: "Node A",
    organizations: "1,2",
    organizationsMatch: "all",
  };
  const statements = [
    ...(await sqlFrom("tiles", query)),
    ...(await sqlFrom("tiles/cells", query)),
    ...(await sqlFrom("legend", query)),
    ...(await sqlFrom("timeExtent", query)),
    ...(await sqlFrom("download", query)),
    ...(await sqlFrom("griddapCoverage", query)),
    await shapeSql(query),
  ].filter((sql) => /FROM cde\./.test(sql));

  assert.ok(
    statements.length >= 6,
    "expected at least one statement per route",
  );
  for (const sql of statements) {
    const head = sql.slice(0, 160);
    assert.match(sql, /platform <> ALL\(/, `omits excludePlatforms: ${head}`);
    assert.match(
      sql,
      /NOT coalesce\(d\.obis_nodes && /,
      `omits excludeObisNodes: ${head}`,
    );
    assert.match(
      sql,
      /organization_pks @> /,
      `omits organizationsMatch: ${head}`,
    );
  }
});

test("every coverageHistogram count reads the same branch set", async () => {
  // Each count builds its own CTE; what must not drift is which sources
  // they read.
  const branchesOf = async (count) => {
    const sql = (await sqlFrom("coverageHistogram", { count }))
      .map(stripEmptyGuard)
      .join(" ");
    return {
      profiles: readsProfiles(sql),
      trajectory: readsTrajectory(sql),
      obis: readsObis(sql),
    };
  };

  const reference = await branchesOf("datasets");
  assert.deepEqual(reference, { profiles: true, trajectory: true, obis: true });
  for (const count of ["features", "days"]) {
    assert.deepEqual(await branchesOf(count), reference, count);
  }

  for (const count of ["datasets", "features", "days"]) {
    const noObis = (
      await sqlFrom("coverageHistogram", { count, includeObis: "false" })
    )
      .map(stripEmptyGuard)
      .join(" ");
    assert.ok(!readsObis(noObis), `${count} kept OBIS`);

    const taxon = (
      await sqlFrom("coverageHistogram", { count, scientificNames: "Gadus" })
    )
      .map(stripEmptyGuard)
      .join(" ");
    assert.ok(
      !readsTrajectory(taxon),
      `${count} kept ERDDAP under a taxon filter`,
    );
  }
});
