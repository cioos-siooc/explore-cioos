import assert from "node:assert/strict";
import fetch from "node-fetch";

const API_URL = process.env.API_URL || "http://localhost:8098/api";

async function cdeQuery(path) {
  const url = `${API_URL}${path}`;
  console.log("Requesting:", url);
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned HTTP ${response.status}`);
  return response.json();
}

const datasets = await cdeQuery("/datasets");
assert.equal(Array.isArray(datasets), true, "/datasets must return an array");
assert.ok(datasets.length > 0, "the sample harvest produced no datasets");

const legend = await cdeQuery("/legend");
assert.ok(legend.recordsCount, "/legend has no recordsCount");

const organizations = await cdeQuery("/organizations");
assert.equal(Array.isArray(organizations), true, "/organizations must return an array");

const oceanVariables = await cdeQuery("/oceanVariables");
assert.equal(Array.isArray(oceanVariables), true, "/oceanVariables must return an array");

const pointQuery = await cdeQuery(
  "/pointQuery?latMin=-90&lonMin=-180&latMax=90&lonMax=180",
);
assert.equal(Array.isArray(pointQuery), true, "/pointQuery must return an array");
assert.ok(pointQuery.length > 0, "the harvested data is not queryable through /pointQuery");

console.log(`Verified API data from ${datasets.length} harvested dataset(s).`);
