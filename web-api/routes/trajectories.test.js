const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /trajectories/platforms returns the per-trajectory summary rows", async () => {
  db.queueRaw([
    {
      trajectory_id: "glider-1",
      time_min: "2024-01-01",
      time_max: "2024-01-05",
      n_points: 500,
    },
  ]);

  const res = await agent
    .get("/trajectories/platforms")
    .query({ datasetPKs: "42" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    {
      trajectory_id: "glider-1",
      time_min: "2024-01-01",
      time_max: "2024-01-05",
      n_points: 500,
    },
  ]);
});

test("GET /trajectories/platforms requires an integer datasetPKs", async () => {
  const res = await agent
    .get("/trajectories/platforms")
    .query({ datasetPKs: "not-an-int" });
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("GET /trajectories/track returns the ordered track as parallel arrays", async () => {
  db.queueRaw([
    {
      longitude: -63.1,
      latitude: 44.6,
      time: "2024-01-01T00:00:00Z",
      profile_id: "p1",
    },
    {
      longitude: -63.2,
      latitude: 44.7,
      time: "2024-01-01T01:00:00Z",
      profile_id: "p2",
    },
  ]);

  const res = await agent
    .get("/trajectories/track")
    .query({ datasetPKs: "42", trajectoryId: "glider-1" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    trajectory_id: "glider-1",
    n_points: 2,
    coordinates: [
      [-63.1, 44.6],
      [-63.2, 44.7],
    ],
    times: ["2024-01-01T00:00:00Z", "2024-01-01T01:00:00Z"],
    profile_ids: ["p1", "p2"],
  });
});

test("GET /trajectories/track accepts an empty trajectoryId (the single-unnamed-trajectory case)", async () => {
  db.queueRaw([]);
  const res = await agent
    .get("/trajectories/track")
    .query({ datasetPKs: "42", trajectoryId: "" });
  assert.equal(res.status, 200);
  assert.equal(res.body.trajectory_id, "");
  assert.equal(res.body.n_points, 0);
});

test("GET /trajectories/track rejects a trajectoryId with disallowed characters", async () => {
  const res = await agent
    .get("/trajectories/track")
    .query({ datasetPKs: "42", trajectoryId: "glider<1>" });
  assert.equal(res.status, 400);
  assert.equal(db.queries.length, 0);
});

test("GET /trajectories/track requires an integer datasetPKs", async () => {
  const res = await agent
    .get("/trajectories/track")
    .query({ datasetPKs: "abc", trajectoryId: "glider-1" });
  assert.equal(res.status, 400);
});

test("GET /trajectories/passes merges each trajectory's runs across hexes", async () => {
  db.queueRaw([
    // glider-1 crosses two selected hexes on one voyage (overlapping and
    // adjacent runs), then comes back a month later.
    {
      trajectory_id: "glider-1",
      first_day: "2024-01-01",
      last_day: "2024-01-02",
    },
    {
      trajectory_id: "glider-1",
      first_day: "2024-01-02",
      last_day: "2024-01-03",
    },
    {
      trajectory_id: "glider-1",
      first_day: "2024-01-04",
      last_day: "2024-01-04",
    },
    {
      trajectory_id: "glider-1",
      first_day: "2024-02-10",
      last_day: "2024-02-11",
    },
    {
      trajectory_id: "glider-2",
      first_day: "2023-12-30",
      last_day: "2023-12-30",
    },
  ]);

  const res = await agent
    .get("/trajectories/passes")
    .query({ datasetPKs: "42", at: "-63.5,44.6", z: "7" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    {
      trajectory_id: "glider-2",
      passes: [{ start: "2023-12-30", end: "2023-12-30" }],
    },
    {
      trajectory_id: "glider-1",
      passes: [
        { start: "2024-01-01", end: "2024-01-04" },
        { start: "2024-02-10", end: "2024-02-11" },
      ],
    },
  ]);
});

test("GET /trajectories/passes clips passes to the time filter", async () => {
  db.queueRaw([
    {
      trajectory_id: "glider-1",
      first_day: "2024-01-01",
      last_day: "2024-01-10",
    },
    {
      trajectory_id: "glider-1",
      first_day: "2024-03-01",
      last_day: "2024-03-02",
    },
  ]);

  const res = await agent.get("/trajectories/passes").query({
    datasetPKs: "42",
    timeMin: "2024-01-05T00:00:00Z",
    timeMax: "2024-02-01T00:00:00Z",
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    {
      trajectory_id: "glider-1",
      passes: [{ start: "2024-01-05", end: "2024-01-10" }],
    },
  ]);
});

test("GET /trajectories/passes resolves `at` to the hex of the zoom's tier, wrapped into ±180", async () => {
  db.queueRaw([]);
  await agent
    .get("/trajectories/passes")
    .query({ datasetPKs: "42", at: "296.5,44.6", z: "3" });
  const [sql] = db.queries;
  assert.match(sql, /cde\.hexes_zoom_0/);
  assert.match(sql, /ST_MakePoint\(-63\.5, 44\.6\)/);
});

test("GET /trajectories/passes without `at` is the shared selection alone", async () => {
  db.queueRaw([]);
  const res = await agent.get("/trajectories/passes").query({
    datasetPKs: "42",
    polygon: "[[-64,44],[-63,44],[-63,45],[-64,44]]",
  });
  assert.equal(res.status, 200);
  const [sql] = db.queries;
  assert.doesNotMatch(sql, /ST_MakePoint/);
  assert.match(sql, /POLYGON\(\(-64 44/);
});

test("GET /trajectories/passes rejects a malformed `at` or a missing `z`", async () => {
  for (const query of [
    { datasetPKs: "42", at: "nope", z: "7" },
    { datasetPKs: "42", at: "-63,95", z: "7" },
    { datasetPKs: "42", at: "-63,44" },
  ]) {
    const res = await agent.get("/trajectories/passes").query(query);
    assert.equal(res.status, 400, JSON.stringify(query));
  }
  assert.equal(db.queries.length, 0);
});
