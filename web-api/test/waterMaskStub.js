const Module = require("node:module");

// Must install before the routes are required. Answers "all water" until a
// test says otherwise, so routes that don't care keep their axios queue to
// themselves.
const waterMaskPath = require.resolve("../utils/waterMask");

function install() {
  const calls = [];
  let mask = null;
  let water = true;
  let error = null;

  const answer = (value) => (error ? Promise.reject(error) : value);

  const stub = new Module(waterMaskPath, null);
  stub.filename = waterMaskPath;
  stub.loaded = true;
  stub.exports = {
    async waterMask(z, x, y) {
      calls.push({ z, x, y });
      return answer(mask ?? new Uint8Array(256 * 256).fill(1));
    },
    async isWaterAt(lon, lat) {
      calls.push({ lon, lat });
      return answer(water);
    },
  };
  require.cache[waterMaskPath] = stub;

  return {
    calls,
    setMask(next) {
      mask = next;
    },
    setWater(next) {
      water = next;
    },
    fail(next) {
      error = next;
    },
    reset() {
      mask = null;
      water = true;
      error = null;
      calls.length = 0;
    },
  };
}

module.exports = { install };
