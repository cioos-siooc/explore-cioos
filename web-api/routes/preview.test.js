const test = require("node:test");
const assert = require("node:assert/strict");

const axiosStub = require("../test/axiosStub");

const axios = axiosStub.install();

const { createTestApp } = require("../test/testApp");
const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  axios.reset();
  resetCache();
});

const FEATURE_ROW = {
  profile_variable: "station_id",
  dataset_id: "obs_270",
  cdm_data_type: "TimeSeries",
  erddap_url: "https://erddap.example.com/erddap",
  profile_id: "1",
  n_records: 500,
  time_max: "2024-03-01T00:00:00Z",
  new_start_time: null,
  use_whole_profile: true,
  table_variables: null,
};

test("returns ERDDAP's tabledap JSON for a resolved record", async () => {
  db.queueRaw([FEATURE_ROW]);
  axios.queueResponse({
    data: { table: { columnNames: ["time", "temp"], rows: [["2024-03-01", 5.2]] } },
  });

  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.table.rows, [["2024-03-01", 5.2]]);
});

test("attaches columnMeta positionally when the harvest recorded table_variables", async () => {
  db.queueRaw([
    {
      ...FEATURE_ROW,
      table_variables: [{ name: "temp", long_name: "Temperature" }],
    },
  ]);
  axios.queueResponse({
    data: { table: { columnNames: ["time", "temp"], rows: [["2024-03-01", 5.2]] } },
  });

  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.table.columnMeta, [
    null,
    { name: "temp", long_name: "Temperature" },
  ]);
});

test("truncates rows to 1000 even when ERDDAP returns more", async () => {
  db.queueRaw([FEATURE_ROW]);
  const manyRows = Array.from({ length: 1500 }, (_, i) => [i]);
  axios.queueResponse({ data: { table: { columnNames: ["i"], rows: manyRows } } });

  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1" });

  assert.equal(res.status, 200);
  assert.equal(res.body.table.rows.length, 1000);
});

test("404s RECORD_NOT_FOUND when the feature query resolves nothing", async () => {
  db.queueRaw([]);
  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "unknown" });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "RECORD_NOT_FOUND");
  assert.equal(axios.calls.length, 0);
});

test("422s NO_RECORD_ID_VARIABLE when the dataset declares no cf_role variable", async () => {
  db.queueRaw([{ ...FEATURE_ROW, profile_variable: null }]);
  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1" });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "NO_RECORD_ID_VARIABLE");
  assert.equal(axios.calls.length, 0);
});

test("404s NO_DATA when ERDDAP itself has nothing for the constraint", async () => {
  db.queueRaw([FEATURE_ROW]);
  axios.queueResponse({ data: { table: { columnNames: [], rows: [] } } });
  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1" });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "NO_DATA");
});

test("404s NO_DATA (not 502) when ERDDAP's error body says no matching results", async () => {
  db.queueRaw([FEATURE_ROW]);
  const error = new Error("Request failed with status code 404");
  error.response = { status: 404, data: "Your query produced no matching results." };
  axios.queueError(error);

  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1" });

  assert.equal(res.status, 404);
  assert.equal(res.body.error, "NO_DATA");
});

test("502s ERDDAP_UNAVAILABLE for a genuine upstream failure", async () => {
  db.queueRaw([FEATURE_ROW]);
  const error = new Error("timeout of 60000ms exceeded");
  axios.queueError(error);

  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1" });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, "ERDDAP_UNAVAILABLE");
  assert.equal(res.body.upstreamStatus, null);
});

// NOTE: check(["dataset","profile"]).isLength({max:256}) with no .exists()/
// .notEmpty() does not reject an ABSENT field in express-validator v6 — only
// one that's present and over length. So a request missing `profile`
// entirely reaches the handler with profile===undefined, which knex's raw
// binding then rejects with "Undefined binding(s)" — an uncaught throw, so
// this is a real 500 (via the app's generic error handler), not a clean 400.
// Documented here as current behaviour, not the intended one.
test("a missing profile reaches the handler and 500s (validation doesn't catch an absent field)", async () => {
  const res = await agent.get("/preview").query({ dataset: "obs_270" });
  assert.equal(res.status, 500);
});

test("escapes ERDDAP regex metacharacters in the profile id constraint", async () => {
  db.queueRaw([{ ...FEATURE_ROW, profile_id: "a.b+c" }]);
  axios.queueResponse({ data: { table: { columnNames: [], rows: [[1]] } } });

  await agent.get("/preview").query({ dataset: "obs_270", profile: "a.b+c" });

  // encodeURIComponent turns the escaped "\+" into "%5C%2B".
  assert.match(axios.calls[0].url, /a%5C\.b%5C%2Bc/);
});
