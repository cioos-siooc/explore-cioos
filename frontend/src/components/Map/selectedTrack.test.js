import { describe, it, expect } from "vitest";

import { selectedTrackFeatures } from "./selectedTrack.js";

const selection = { trajectoryId: "glider-1", datasetTitle: "Gliders" };
const track = {
  coordinates: [
    [-63, 44],
    [-63.1, 44.1],
    [-63.2, 44.2],
    [-63.3, 44.3],
  ],
  times: [
    "2024-01-01T00:00:00Z",
    "2024-01-01T01:00:00Z",
    "2024-01-01T02:00:00Z",
    "2024-01-01T03:00:00Z",
  ],
  profileIds: ["p0", "p1", "p2", "p3"],
};
const lines = (features) =>
  features.filter((f) => f.geometry.type === "LineString");
const fixes = (features) => features.filter((f) => f.geometry.type === "Point");

describe("selectedTrackFeatures", () => {
  it("draws the whole track as a line and one fix per point", () => {
    const features = selectedTrackFeatures(track, {}, selection);
    expect(lines(features)).toHaveLength(1);
    expect(lines(features)[0].geometry.coordinates).toEqual(track.coordinates);
    expect(fixes(features).map((f) => f.properties.profile_id)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
    ]);
    expect(fixes(features)[0].properties).toMatchObject({
      trajectory_id: "glider-1",
      dataset_title: "Gliders",
      time: track.times[0],
    });
    expect(fixes(features).every((f) => "cog" in f.properties)).toBe(true);
  });

  it("clips to the time window, keeping times and record ids aligned", () => {
    const features = selectedTrackFeatures(
      track,
      {
        min: Date.parse("2024-01-01T00:30:00Z"),
        max: Date.parse("2024-01-01T02:30:00Z"),
      },
      selection,
    );
    expect(fixes(features).map((f) => f.properties.profile_id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(fixes(features)[0].properties.time).toBe(track.times[1]);
  });

  it("is empty when the window misses the track", () => {
    expect(
      selectedTrackFeatures(
        track,
        { min: Date.parse("2025-01-01T00:00:00Z") },
        selection,
      ),
    ).toEqual([]);
  });

  it("leaves a lone fix without a course and without a line", () => {
    const features = selectedTrackFeatures(
      { coordinates: [[-63, 44]], times: [track.times[0]] },
      {},
      selection,
    );
    expect(lines(features)).toHaveLength(0);
    expect(fixes(features)[0].properties).not.toHaveProperty("cog");
    expect(fixes(features)[0].properties).not.toHaveProperty("profile_id");
  });
});
