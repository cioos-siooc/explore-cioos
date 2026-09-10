const path = require("node:path");
const Module = require("node:module");

// Stands in for ../db so route tests need no Postgres — the same trick
// utils/selectionAgreement.test.js uses (see its own comment for why a
// builder-only knex instance never actually connects), generalised into a
// reusable seam: install() must run before anything (a route file, app.js)
// requires "../db", since require.cache is what's being overwritten and a
// module already loaded from the real path keeps its own reference.
//
// Unlike selectionAgreement's fixed `{ rows: [{}] }`, this queues per-call
// results so a route issuing several db.raw()/query-builder calls in sequence
// (e.g. harvest.js's runDetail() then runAttempts()) can be driven one at a
// time, in the order the route actually issues them.

const dbPath = require.resolve("../db");
const knex = require("knex")({ client: "pg" });

function install() {
  const queries = [];
  let queue = [];

  function nextResult() {
    if (!queue.length) {
      throw new Error(
        "dbStub: a db call ran with nothing queued — call db.queueRaw()/queueRows() " +
          "once per db.raw()/query-builder call the route under test will make, " +
          "in the order it makes them.",
      );
    }
    return queue.shift();
  }

  function resolveWith(result) {
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  }

  // db.raw(sql, bindings) — resolves to whatever was queued, typically
  // { rows: [...] } to match node-pg's real shape.
  //
  // Lazy on purpose: utils/dbFilter.js's createDBFilter() calls db.raw()
  // several times to build SQL FRAGMENTS (its `shared`/`obisOnly`/
  // `profileOnly` return values), which the calling route embeds — via a
  // `:filters`-style binding — into its OWN db.raw() call rather than ever
  // awaiting the fragment directly. Consuming the queue at call time would
  // have those fragment-only raws eat results meant for the route's real,
  // terminal (awaited) query. Consuming at .then() time means only a Raw
  // someone actually awaits counts as "a call".
  function fakeRaw(sql, bindings) {
    const raw = bindings === undefined ? knex.raw(sql) : knex.raw(sql, bindings);
    raw.then = (onFulfilled, onRejected) => {
      queries.push(raw.toString());
      const result = nextResult();
      return resolveWith(result).then(onFulfilled, onRejected);
    };
    return raw;
  }

  // db("table")...  — the query-builder form a couple of routes use
  // (organizations.js's SELECT, download.js's .insert()). Resolves to
  // whatever was queued — a plain array for a SELECT, whatever .insert()'s
  // caller expects (routes here never read an insert's return value).
  function fakeQueryBuilder(...args) {
    const builder = knex(...args);
    const originalThen = builder.then.bind(builder);
    builder.then = (onFulfilled, onRejected) => {
      queries.push(builder.toString());
      const result = nextResult();
      return resolveWith(result).then(onFulfilled, onRejected);
    };
    // Silence unhandled-rejection noise from knex's own internal bookkeeping,
    // which some builder methods touch before our .then override is hit.
    void originalThen;
    return builder;
  }

  function fakeDb(...args) {
    return fakeQueryBuilder(...args);
  }
  fakeDb.raw = fakeRaw;

  const stub = new Module(dbPath, null);
  stub.filename = dbPath;
  stub.loaded = true;
  stub.exports = fakeDb;
  require.cache[dbPath] = stub;

  return {
    queries,
    // Queue a { rows: [...] } result for the next db.raw() call.
    queueRaw(rows) {
      queue.push({ rows });
    },
    // Queue a plain-array result for the next db("table")... call.
    queueRows(rows) {
      queue.push(rows);
    },
    // Queue an Error for the next call (raw or builder) to reject with.
    queueError(error) {
      queue.push(error);
    },
    reset() {
      queue = [];
      queries.length = 0;
    },
  };
}

module.exports = { install, dbPath };
