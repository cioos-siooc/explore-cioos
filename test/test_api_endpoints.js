import assert from "node:assert/strict";
import fetch from "node-fetch";

const API_URL = process.env.API_URL || "http://localhost:8098/api";
const latitude = Number(process.env.CI_LATITUDE);
const longitude = Number(process.env.CI_LONGITUDE);

assert.ok(Number.isFinite(latitude), "CI_LATITUDE must be a finite number");
assert.ok(Number.isFinite(longitude), "CI_LONGITUDE must be a finite number");

async function cdeRequest(path, expectedStatus = 200) {
  const url = `${API_URL}${path}`;
  console.log("Requesting:", url);
  const response = await fetch(url);
  assert.equal(
    response.status,
    expectedStatus,
    `${url} returned HTTP ${response.status}`,
  );
  return response.json();
}

const datasets = await cdeRequest("/datasets");
assert.equal(Array.isArray(datasets), true, "/datasets must return an array");
assert.ok(datasets.length > 0, "the sample harvest produced no datasets");

const legend = await cdeRequest("/legend");
assert.ok(legend.recordsCount, "/legend has no recordsCount");

const organizations = await cdeRequest("/organizations");
assert.equal(
  Array.isArray(organizations),
  true,
  "/organizations must return an array",
);

const oceanVariables = await cdeRequest("/oceanVariables");
assert.equal(
  Array.isArray(oceanVariables),
  true,
  "/oceanVariables must return an array",
);

const delta = 0.01;
const platforms = await cdeRequest("/platforms");
assert.equal(Array.isArray(platforms), true, "/platforms must return an array");

const erddapServers = await cdeRequest("/erddapServers");
assert.equal(
  Array.isArray(erddapServers),
  true,
  "/erddapServers must return an array",
);

const obisNodes = await cdeRequest("/obisNodes");
assert.equal(Array.isArray(obisNodes), true, "/obisNodes must return an array");
assert.ok(obisNodes.every((node) => typeof node.name === "string"));

const scientificNames = await cdeRequest("/scientificNames?q=orca");
assert.equal(
  Array.isArray(scientificNames),
  true,
  "/scientificNames must return an array",
);

const pointQuery = await cdeRequest(
  `/pointQuery?latMin=${latitude - delta}&lonMin=${longitude - delta}&latMax=${latitude + delta}&lonMax=${longitude + delta}`,
);
assert.equal(
  Array.isArray(pointQuery),
  true,
  "/pointQuery must return an array",
);
assert.ok(
  pointQuery.length > 0,
  "the harvested data is not queryable through /pointQuery",
);

const datasetPks = new Set(datasets.map((dataset) => dataset.pk));
assert.ok(
  pointQuery.every((dataset) => datasetPks.has(dataset.pk)),
  "/pointQuery returned a dataset absent from /datasets",
);

const selectedDataset = pointQuery[0];
const filteredPointQuery = await cdeRequest(
  `/pointQuery?datasetPKs=${encodeURIComponent(selectedDataset.pk)}`,
);
assert.ok(
  filteredPointQuery.every((dataset) => dataset.pk === selectedDataset.pk),
  "/pointQuery datasetPKs filter returned another dataset",
);

const estimate = await cdeRequest(
  `/downloadEstimate?datasetPKs=${encodeURIComponent(selectedDataset.pk)}`,
);
assert.ok(
  estimate.every((dataset) => dataset.pk === selectedDataset.pk),
  "/downloadEstimate datasetPKs filter returned another dataset",
);

await cdeRequest("/pointQuery?timeMin=not-a-date", 400);
await cdeRequest("/legend?depthMin=not-an-integer", 400);
await cdeRequest("/scientificNames?q=%3Cscript%3E", 400);

console.log(`Verified API data from ${datasets.length} harvested dataset(s).`);
