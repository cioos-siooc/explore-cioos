import assert from "node:assert/strict";
import fetch from "node-fetch";

const API_URL = process.env.API_URL || "http://localhost:8098/api";
const latitude = Number(process.env.CI_LATITUDE);
const longitude = Number(process.env.CI_LONGITUDE);
const time = new Date(process.env.CI_TIME);

assert.ok(Number.isFinite(latitude), "CI_LATITUDE must be a finite number");
assert.ok(Number.isFinite(longitude), "CI_LONGITUDE must be a finite number");
assert.equal(Number.isNaN(time.getTime()), false, "CI_TIME must be an ISO timestamp");

// Use a tiny box and two-hour time window around an actually harvested profile
// so the scheduler receives a bounded request that contains data.
const delta = 0.01;
const timeDelta = 60 * 60 * 1000;
const query = new URLSearchParams({
  email: "ci@example.invalid",
  latMin: String(latitude - delta),
  latMax: String(latitude + delta),
  lonMin: String(longitude - delta),
  lonMax: String(longitude + delta),
  timeMin: new Date(time.getTime() - timeDelta).toISOString(),
  timeMax: new Date(time.getTime() + timeDelta).toISOString(),
});
const url = `${API_URL}/download?${query}`;
console.log("Submitting download request:", url);

const response = await fetch(url);
assert.equal(response.ok, true, `${url} returned HTTP ${response.status}`);
const result = await response.json();
assert.ok(result.count > 0, "download request did not select any harvested datasets");
console.log(`Queued download for ${result.count} dataset(s).`);
