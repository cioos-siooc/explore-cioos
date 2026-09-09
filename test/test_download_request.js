import assert from "node:assert/strict";
import fetch from "node-fetch";

const API_URL = process.env.API_URL || "http://localhost:8098/api";
const latitude = Number(process.env.CI_LATITUDE);
const longitude = Number(process.env.CI_LONGITUDE);
const timeMin = new Date(process.env.CI_TIME_MIN);
const timeMax = new Date(process.env.CI_TIME_MAX);

assert.ok(Number.isFinite(latitude), "CI_LATITUDE must be a finite number");
assert.ok(Number.isFinite(longitude), "CI_LONGITUDE must be a finite number");
assert.equal(Number.isNaN(timeMin.getTime()), false, "CI_TIME_MIN must be an ISO timestamp");
assert.equal(Number.isNaN(timeMax.getTime()), false, "CI_TIME_MAX must be an ISO timestamp");
assert.ok(timeMax >= timeMin, "CI_TIME_MAX must not precede CI_TIME_MIN");

// Use the selected profile's actual extent plus a one-day buffer. A polygon is
// required here: the downloader intentionally derives its ERDDAP bbox from the
// polygon, not from the API's lat/lon query parameters.
const delta = 0.01;
const timeDelta = 24 * 60 * 60 * 1000;
const polygon = [
  [longitude - delta, latitude - delta],
  [longitude + delta, latitude - delta],
  [longitude + delta, latitude + delta],
  [longitude - delta, latitude + delta],
  [longitude - delta, latitude - delta],
];
const query = new URLSearchParams({
  email: "ci@example.invalid",
  polygon: JSON.stringify(polygon),
  timeMin: new Date(timeMin.getTime() - timeDelta).toISOString(),
  timeMax: new Date(timeMax.getTime() + timeDelta).toISOString(),
});
const url = `${API_URL}/download?${query}`;
console.log("Submitting download request:", url);

const response = await fetch(url);
assert.equal(response.ok, true, `${url} returned HTTP ${response.status}`);
const result = await response.json();
assert.ok(result.count > 0, "download request did not select any harvested datasets");
console.log(`Queued download for ${result.count} dataset(s).`);
