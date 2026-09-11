const Module = require("node:module");

// Stands in for axios so route tests never make a real HTTP call to ERDDAP
// (routes/preview.js) or the CHS NONNA gateway (routes/nonna.js). Must run
// before the route module that calls axios.get is required.
const axiosPath = require.resolve("axios");

function install() {
  const calls = [];
  let queue = [];

  const stub = new Module(axiosPath, null);
  stub.filename = axiosPath;
  stub.loaded = true;
  stub.exports = {
    async get(url, config) {
      calls.push({ url, config });
      if (!queue.length) {
        throw new Error(
          "axiosStub: axios.get() called with nothing queued — call " +
            "axios.queueResponse()/queueError() once per call the route will make.",
        );
      }
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
  require.cache[axiosPath] = stub;

  return {
    calls,
    // Queue a resolved axios response, e.g. { data: {...}, status: 200 }.
    queueResponse(response) {
      queue.push(response);
    },
    // Queue a rejection. Shape it like a real axios error (`.response.status`,
    // `.response.data`, `.message`) when the route branches on those.
    queueError(error) {
      queue.push(error);
    },
    reset() {
      queue = [];
      calls.length = 0;
    },
  };
}

module.exports = { install, axiosPath };
