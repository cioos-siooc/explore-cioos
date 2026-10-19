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
    data: {
      table: { columnNames: ["time", "temp"], rows: [["2024-03-01", 5.2]] },
    },
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
    data: {
      table: { columnNames: ["time", "temp"], rows: [["2024-03-01", 5.2]] },
    },
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
  axios.queueResponse({
    data: { table: { columnNames: ["i"], rows: manyRows } },
  });

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
  error.response = {
    status: 404,
    data: "Your query produced no matching results.",
  };
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

// NOTE: isLength() without .exists() does not reject an absent field in
// express-validator v6, so a missing `profile` reaches knex as an undefined
// binding and 500s. Documents current behaviour, not the intended one.
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

// --- stepping to one profile inside a record ---------------------------------

// A TimeSeriesProfile: the record is the station, the step is the cast.
const STEPPED_ROW = {
  ...FEATURE_ROW,
  cdm_data_type: "TimeSeriesProfile",
  dataset_id: "mpoPmzaVikingCtdBinned",
  profile_variable: "station_id",
  step_variable: "profile",
  profile_id: "AZMP-ESG",
  n_records: 26000,
  use_whole_profile: false,
  new_start_time: "2024-10-01T00:00:00Z",
};

// mpoSgdoADCP publishes cf_role=profile_id on its TIME column.
const TIME_STEPPED_ROW = {
  ...STEPPED_ROW,
  dataset_id: "mpoSgdoADCP",
  profile_variable: "id",
  step_variable: "time",
  profile_id: "MADCP_2023016_ANTICOSTIEST_24952_900",
};

test("`at` constrains to one profile and drops the tail-window constraint", async () => {
  db.queueRaw([STEPPED_ROW]);
  axios.queueResponse({
    data: { table: { columnNames: ["depth"], rows: [[1]] } },
  });

  const res = await agent.get("/preview").query({
    dataset: "mpoPmzaVikingCtdBinned",
    profile: "AZMP-ESG",
    at: "AZMP-ESG-21/05/20-23:01:41",
  });

  assert.equal(res.status, 200);
  const { url } = axios.calls[0];
  assert.match(url, /profile=~/);
  // The point of `at` is to reach a cast OUTSIDE the window; keeping both would
  // answer nothing.
  assert.ok(!url.includes("time%3E") && !url.includes("time>"));
});

test("a time step column goes in unquoted — ERDDAP rejects a regex there", async () => {
  db.queueRaw([TIME_STEPPED_ROW]);
  axios.queueResponse({
    data: { table: { columnNames: ["depth"], rows: [[1]] } },
  });

  await agent.get("/preview").query({
    dataset: "mpoSgdoADCP",
    profile: "MADCP_2023016_ANTICOSTIEST_24952_900",
    at: "2023-06-12T19:20:00Z",
  });

  const { url } = axios.calls[0];
  assert.ok(url.includes("&time=2023-06-12T19%3A20%3A00Z"));
  assert.ok(!url.includes("time=~"));
});

test("`at` on a record with no step column is ignored, not obeyed", async () => {
  // A plain TimeSeries: its own id is the only one there is, so a step
  // constraint would be the record constraint written twice.
  db.queueRaw([{ ...FEATURE_ROW, step_variable: null }]);
  axios.queueResponse({
    data: { table: { columnNames: ["time"], rows: [["2024-03-01"]] } },
  });

  await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1", at: "anything" });

  assert.equal(axios.calls[0].url.match(/=~/g).length, 1);
});

test("without `at` the query is exactly what it always was", async () => {
  db.queueRaw([STEPPED_ROW]);
  axios.queueResponse({
    data: { table: { columnNames: ["depth"], rows: [[1]] } },
  });

  await agent
    .get("/preview")
    .query({ dataset: "mpoPmzaVikingCtdBinned", profile: "AZMP-ESG" });

  const { url } = axios.calls[0];
  assert.ok(url.includes("station_id=~"));
  assert.ok(!url.includes("&profile=~"));
  assert.ok(url.includes("time>2024-10-01T00:00:00Z"));
});

// A TimeSeriesProfile harvested per cast: the record id is a cast, resolved to
// its station plus the cast as the default step.
const CAST_ROW = {
  ...STEPPED_ROW,
  profile_id: "PMZA-VAS",
  record_step: "PMZA-VAS-24/10/14-08:31:41",
};

test("a cast record without `at` draws its own cast at its station", async () => {
  db.queueRaw([CAST_ROW]);
  axios.queueResponse({
    data: { table: { columnNames: ["depth"], rows: [[1]] } },
  });

  const res = await agent.get("/preview").query({
    dataset: "mpoPmzaVikingCtdBinned",
    profile: "PMZA-VAS-24/10/14-08:31:41",
  });

  assert.equal(res.status, 200);
  const { url } = axios.calls[0];
  assert.ok(url.includes(`station_id=~${encodeURIComponent('"PMZA-VAS"')}`));
  assert.ok(
    url.includes(
      `&profile=~${encodeURIComponent('"PMZA-VAS-24/10/14-08:31:41"')}`,
    ),
  );
  assert.ok(!url.includes("time>"));
});

test("`at` wins over a cast record's own cast", async () => {
  db.queueRaw([CAST_ROW]);
  axios.queueResponse({
    data: { table: { columnNames: ["depth"], rows: [[1]] } },
  });

  await agent.get("/preview").query({
    dataset: "mpoPmzaVikingCtdBinned",
    profile: "PMZA-VAS-24/10/14-08:31:41",
    at: "PMZA-VAS-24/10/10-14:01:41",
  });

  const { url } = axios.calls[0];
  assert.ok(url.includes(encodeURIComponent('"PMZA-VAS-24/10/10-14:01:41"')));
  assert.ok(!url.includes(encodeURIComponent("24/10/14-08:31:41")));
});

// --- /preview/profiles -------------------------------------------------------

test("a cast record lists its station's casts and names its own as current", async () => {
  db.queueRaw([CAST_ROW]);
  axios.queueResponse({
    data: {
      table: {
        columnNames: ["profile", "time"],
        rows: [["PMZA-VAS-24/10/14-08:31:41", "2024-10-14T08:31:41Z"]],
      },
    },
  });

  const res = await agent.get("/preview/profiles").query({
    dataset: "mpoPmzaVikingCtdBinned",
    profile: "PMZA-VAS-24/10/14-08:31:41",
  });

  assert.equal(res.body.current, "PMZA-VAS-24/10/14-08:31:41");
  assert.ok(
    axios.calls[0].url.includes(
      `station_id=~${encodeURIComponent('"PMZA-VAS"')}`,
    ),
  );
});

test("lists a record's casts, earliest first, with their times", async () => {
  db.queueRaw([STEPPED_ROW]);
  axios.queueResponse({
    data: {
      table: {
        columnNames: ["profile", "time"],
        rows: [
          ["cast-b", "2021-05-21T10:00:00Z"],
          ["cast-a", "2021-05-20T23:01:41Z"],
        ],
      },
    },
  });

  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "mpoPmzaVikingCtdBinned", profile: "AZMP-ESG" });

  assert.equal(res.status, 200);
  assert.equal(res.body.column, "profile");
  assert.equal(res.body.count, 2);
  assert.equal(res.body.truncated, false);
  assert.equal(res.body.current, null);
  assert.deepEqual(res.body.steps, [
    { value: "cast-a", time: "2021-05-20T23:01:41Z" },
    { value: "cast-b", time: "2021-05-21T10:00:00Z" },
  ]);
  // distinct() over the pair, constrained to this record only.
  assert.match(axios.calls[0].url, /\?profile,time&station_id=~/);
  assert.match(axios.calls[0].url, /&distinct\(\)$/);
});

test("a time step column is not asked for twice", async () => {
  db.queueRaw([TIME_STEPPED_ROW]);
  axios.queueResponse({
    data: {
      table: { columnNames: ["time"], rows: [["2023-06-12T19:20:00Z"]] },
    },
  });

  const res = await agent.get("/preview/profiles").query({
    dataset: "mpoSgdoADCP",
    profile: "MADCP_2023016_ANTICOSTIEST_24952_900",
  });

  assert.match(axios.calls[0].url, /\?time&id=~/);
  assert.deepEqual(res.body.steps, [
    { value: "2023-06-12T19:20:00Z", time: "2023-06-12T19:20:00Z" },
  ]);
});

test("a profile spanning several timestamps is listed once", async () => {
  db.queueRaw([STEPPED_ROW]);
  axios.queueResponse({
    data: {
      table: {
        columnNames: ["profile", "time"],
        rows: [
          ["cast-a", "2021-05-20T23:01:41Z"],
          ["cast-a", "2021-05-20T23:04:00Z"],
        ],
      },
    },
  });

  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "mpoPmzaVikingCtdBinned", profile: "AZMP-ESG" });

  assert.equal(res.body.count, 1);
  assert.equal(res.body.steps[0].time, "2021-05-20T23:01:41Z");
});

test("past 5000 casts it samples, reports the true count, and keeps the last", async () => {
  db.queueRaw([STEPPED_ROW]);
  const many = Array.from({ length: 12345 }, (_, index) => [
    `cast-${String(index).padStart(5, "0")}`,
    new Date(Date.UTC(2021, 4, 20) + index * 60000).toISOString(),
  ]);
  axios.queueResponse({
    data: { table: { columnNames: ["profile", "time"], rows: many } },
  });

  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "mpoPmzaVikingCtdBinned", profile: "AZMP-ESG" });

  assert.equal(res.body.count, 12345);
  assert.equal(res.body.truncated, true);
  assert.ok(res.body.steps.length <= 5000);
  // The end of the record stays reachable, whatever the stride divides into.
  assert.equal(res.body.steps.at(-1).value, "cast-12344");
});

test("a record with no step column answers an empty list, not an error", async () => {
  db.queueRaw([{ ...FEATURE_ROW, step_variable: null }]);

  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "obs_270", profile: "1" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    column: null,
    steps: [],
    count: 0,
    truncated: false,
  });
  // A Profile record's own id IS its step column, so it must not query either.
  assert.equal(axios.calls.length, 0);
});

test("a Profile record is not stepped: its id is both columns", async () => {
  db.queueRaw([
    {
      ...FEATURE_ROW,
      cdm_data_type: "Profile",
      profile_variable: "profile_id",
      step_variable: "profile_id",
    },
  ]);

  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "obs_270", profile: "1" });

  assert.equal(res.body.count, 0);
  assert.equal(axios.calls.length, 0);
});

test("an unknown record is 404 here too", async () => {
  db.queueRaw([]);
  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "nope", profile: "1" });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "RECORD_NOT_FOUND");
});

test("an empty record has no casts, which is an answer and not an outage", async () => {
  db.queueRaw([STEPPED_ROW]);
  const error = new Error("Request failed with status code 404");
  error.response = {
    status: 404,
    data: "Your query produced no matching results",
  };
  axios.queueError(error);

  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "mpoPmzaVikingCtdBinned", profile: "AZMP-ESG" });

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
});

test("a real upstream failure is reported as one", async () => {
  db.queueRaw([STEPPED_ROW]);
  const error = new Error("Request failed with status code 500");
  error.response = { status: 500, data: "boom" };
  axios.queueError(error);

  const res = await agent
    .get("/preview/profiles")
    .query({ dataset: "mpoPmzaVikingCtdBinned", profile: "AZMP-ESG" });

  assert.equal(res.status, 502);
  assert.equal(res.body.error, "ERDDAP_UNAVAILABLE");
  assert.equal(res.body.upstreamStatus, 500);
});

test("a requested period replaces the cadence window in the ERDDAP query", async () => {
  db.queueRaw([
    {
      ...FEATURE_ROW,
      use_whole_profile: false,
      new_start_time: "2024-02-01T00:00:00Z",
    },
  ]);
  axios.queueResponse({
    data: { table: { columnNames: ["time"], rows: [["2020-01-03"]] } },
  });

  const res = await agent.get("/preview").query({
    dataset: "obs_270",
    profile: "1",
    timeMin: "2020-01-03T00:00:00Z",
    timeMax: "2020-01-05T23:59:59Z",
  });

  assert.equal(res.status, 200);
  const { url } = axios.calls[0];
  assert.match(
    url,
    /&time>=2020-01-03T00:00:00\.000Z&time<=2020-01-05T23:59:59\.000Z$/,
  );
  assert.doesNotMatch(url, /time>2024/);
});

test("rejects a period that is not an ISO 8601 instant", async () => {
  const res = await agent
    .get("/preview")
    .query({ dataset: "obs_270", profile: "1", timeMin: "yesterday" });
  assert.equal(res.status, 400);
  assert.equal(axios.calls.length, 0);
});

test("`at` wins over a period: a single cast needs no time window", async () => {
  db.queueRaw([STEPPED_ROW]);
  axios.queueResponse({
    data: { table: { columnNames: ["depth"], rows: [[1]] } },
  });

  await agent.get("/preview").query({
    dataset: "mpoPmzaVikingCtdBinned",
    profile: "AZMP-ESG",
    at: "AZMP-ESG-21/05/20-23:01:41",
    timeMin: "2020-01-03T00:00:00Z",
    timeMax: "2020-01-05T23:59:59Z",
  });

  const { url } = axios.calls[0];
  assert.ok(url.includes("&profile=~"));
  assert.ok(!url.includes("time>") && !url.includes("time<"));
});
