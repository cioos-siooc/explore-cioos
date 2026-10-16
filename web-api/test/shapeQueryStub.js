const Module = require("node:module");

// shapeQuery's SQL is pinned by utils/shapeQuery.test.js; this keeps route
// tests from fabricating rows a real query would need. Must install before
// the route module that calls getShapeQuery is required.
const shapeQueryPath = require.resolve("../utils/shapeQuery");

function install() {
  const calls = [];
  let queue = [];

  function next(name) {
    if (!queue.length) {
      throw new Error(
        `shapeQueryStub: ${name}() called with nothing queued — ` +
          "call shapeQuery.queueResult() once per call the route will make.",
      );
    }
    const result = queue.shift();
    if (result instanceof Error) throw result;
    return result;
  }

  const stub = new Module(shapeQueryPath, null);
  stub.filename = shapeQueryPath;
  stub.loaded = true;
  stub.exports = {
    async getShapeQuery(query, doEstimate, getRecordsList) {
      calls.push({ query, doEstimate, getRecordsList });
      return next("getShapeQuery");
    },
    async getDatasetPksInShape(query) {
      calls.push({ query, pksOnly: true });
      return next("getDatasetPksInShape");
    },
    async buildShapeSql() {
      throw new Error("shapeQueryStub: buildShapeSql() is not stubbed");
    },
  };
  require.cache[shapeQueryPath] = stub;

  return {
    calls,
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
