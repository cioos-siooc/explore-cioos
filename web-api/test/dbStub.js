const Module = require("node:module");

// Must install before anything requires "../db": a module already loaded
// from the real path keeps its own reference. Results are queued per awaited
// call, in the order the route issues them.

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

  // Lazy: createDBFilter builds Raw fragments that are embedded in the
  // route's own query, never awaited, so only an awaited Raw consumes a
  // queued result.
  function fakeRaw(sql, bindings) {
    const raw =
      bindings === undefined ? knex.raw(sql) : knex.raw(sql, bindings);
    raw.then = (onFulfilled, onRejected) => {
      queries.push(raw.toString());
      const result = nextResult();
      return resolveWith(result).then(onFulfilled, onRejected);
    };
    return raw;
  }

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
    queueRaw(rows) {
      queue.push({ rows });
    },
    queueRows(rows) {
      queue.push(rows);
    },
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
