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
    { trajectory_id: "glider-1", time_min: "2024-01-01", time_max: "2024-01-05", n_points: 500 },
  ]);

  const res = await agent
    .get("/trajectories/platforms")
    .query({ datasetPKs: "42" });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    { trajectory_id: "glider-1", time_min: "2024-01-01", time_max: "2024-01-05", n_points: 500 },
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
    { longitude: -63.1, latitude: 44.6, time: "2024-01-01T00:00:00Z", profile_id: "p1" },
    { longitude: -63.2, latitude: 44.7, time: "2024-01-01T01:00:00Z", profile_id: "p2" },
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
