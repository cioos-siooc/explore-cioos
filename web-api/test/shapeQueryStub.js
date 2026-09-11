const Module = require("node:module");

// Stands in for utils/shapeQuery.js for routes that only ever call it —
// pointQuery.js, datasetRecordsList.js, downloadEstimate.js, and (alongside
// its own db.raw/insert calls) download.js. shapeQuery.js's own SQL-building
// correctness is already pinned by utils/shapeQuery.test.js; these routes'
// tests are about validation, response shaping and their OWN side effects,
// so isolating them from shapeQuery's real SQL keeps them from having to
// fabricate rows a real query would need.
//
// Must run before the route module that calls getShapeQuery is required.
const shapeQueryPath = require.resolve("../utils/shapeQuery");

function install() {
  const calls = [];
  let queue = [];

  const stub = new Module(shapeQueryPath, null);
  stub.filename = shapeQueryPath;
  stub.loaded = true;
  stub.exports = {
    async getShapeQuery(query, doEstimate, getRecordsList) {
      calls.push({ query, doEstimate, getRecordsList });
      if (!queue.length) {
        throw new Error(
          "shapeQueryStub: getShapeQuery() called with nothing queued — " +
            "call shapeQuery.queueResult() once per call the route will make.",
        );
      }
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    async buildShapeSql() {
      throw new Error("shapeQueryStub: buildShapeSql() is not stubbed");
    },
  };
  require.cache[shapeQueryPath] = stub;

  return {
    calls,
    // Queue the array getShapeQuery should resolve to on its next call.
    queueResult(rows) {
      queue.push(rows);
    },
    queueError(error) {
      queue.push(error);
    },
    reset() {
      queue = [];
      calls.length = 0;
    },
  };
}

module.exports = { install, shapeQueryPath };
