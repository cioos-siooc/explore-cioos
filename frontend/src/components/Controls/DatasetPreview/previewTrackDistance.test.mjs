import { test } from "node:test";
import assert from "node:assert/strict";

import { variablesFrom } from "./previewVariables.js";
import {
  EUCLIDEAN_DISTANCE_COLUMN,
  TOTAL_DISTANCE_TRAVELED_COLUMN,
  distanceRowsFor,
  trackDistancesFor,
} from "./previewTrackDistance.js";
import { VIKING, VIKING_DATASET } from "./previewVariables.test.mjs";

const TRACK_DATASET = { ...VIKING_DATASET, cdm_data_type: "Trajectory" };

// One degree of arc on turf's mean Earth radius (6371.0088 km).
const DEGREE_KM = (6371.0088 * Math.PI) / 180;

const variablesOf = (dataset = TRACK_DATASET) => variablesFrom(VIKING, dataset);

const distancesFor = (data, dataset = TRACK_DATASET) =>
  trackDistancesFor(dataset, variablesOf(dataset), data, {
    totalDistanceTraveled: "Total distance traveled",
    euclideanDistance: "Euclidean distance",
  });

const assertKilometres = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    if (expected[index] === null) {
      assert.equal(value, null, `row ${index}`);
    } else {
      assert.ok(
        Math.abs(value - expected[index]) < 1e-6,
        `row ${index}: ${value} vs ${expected[index]}`,
      );
    }
  });
};

// Along a meridian, out of time order: the last row is the earliest.
const OUT_OF_ORDER = [
  { time: "2021-05-24T18:00:00Z", latitude: 1, longitude: 0 },
  { time: "2021-05-24T19:00:00Z", latitude: 2, longitude: 0 },
  { time: "2021-05-24T17:00:00Z", latitude: 0, longitude: 0 },
];

test("distances follow time order and stay indexed like the input rows", () => {
  const distances = distancesFor(OUT_OF_ORDER);
  assertKilometres(distances.totalDistanceTraveled, [
    DEGREE_KM,
    2 * DEGREE_KM,
    0,
  ]);
  assertKilometres(distances.euclideanDistance, [DEGREE_KM, 2 * DEGREE_KM, 0]);
});

test("a track that turns back keeps travelling while it nears its start", () => {
  const turningBack = [
    { time: "2021-05-24T17:00:00Z", latitude: 0, longitude: 0 },
    { time: "2021-05-24T18:00:00Z", latitude: 1, longitude: 0 },
    { time: "2021-05-24T19:00:00Z", latitude: 0.5, longitude: 0 },
  ];
  const distances = distancesFor(turningBack);
  assertKilometres(distances.totalDistanceTraveled, [
    0,
    DEGREE_KM,
    1.5 * DEGREE_KM,
  ]);
  assertKilometres(distances.euclideanDistance, [
    0,
    DEGREE_KM,
    0.5 * DEGREE_KM,
  ]);
});

test("a row with no position gets no distance, and the total carries on", () => {
  const withGap = [
    { time: "2021-05-24T17:00:00Z", latitude: 0, longitude: 0 },
    { time: "2021-05-24T18:00:00Z", latitude: null, longitude: 0 },
    { time: "2021-05-24T19:00:00Z", latitude: 1, longitude: 0 },
  ];
  const distances = distancesFor(withGap);
  assertKilometres(distances.totalDistanceTraveled, [0, null, DEGREE_KM]);
  assertKilometres(distances.euclideanDistance, [0, null, DEGREE_KM]);
});

test("crossing the antimeridian is a short hop, not a trip around the globe", () => {
  const acrossDateLine = [
    { time: "2021-05-24T17:00:00Z", latitude: 0, longitude: 179.5 },
    { time: "2021-05-24T18:00:00Z", latitude: 0, longitude: -179.5 },
  ];
  assertKilometres(distancesFor(acrossDateLine).totalDistanceTraveled, [
    0,
    DEGREE_KM,
  ]);
});

test("a trajectory profile's depths at one position add no distance", () => {
  const profiles = [
    { time: "2021-05-24T17:00:00Z", latitude: 0, longitude: 0, depth: 1 },
    { time: "2021-05-24T17:00:00Z", latitude: 0, longitude: 0, depth: 5 },
    { time: "2021-05-24T18:00:00Z", latitude: 1, longitude: 0, depth: 1 },
    { time: "2021-05-24T18:00:00Z", latitude: 1, longitude: 0, depth: 5 },
  ];
  const distances = distancesFor(profiles, {
    ...VIKING_DATASET,
    cdm_data_type: "TrajectoryProfile",
  });
  assertKilometres(distances.totalDistanceTraveled, [
    0,
    0,
    DEGREE_KM,
    DEGREE_KM,
  ]);
});

test("only tracks get distances", () => {
  for (const type of ["Profile", "TimeSeriesProfile", "TimeSeries", "Point"]) {
    assert.equal(
      distancesFor(OUT_OF_ORDER, { ...VIKING_DATASET, cdm_data_type: type }),
      null,
      type,
    );
  }
});

test("one row is not a track", () => {
  assert.equal(distancesFor(OUT_OF_ORDER.slice(0, 1)), null);
  assert.equal(distancesFor([]), null);
});

test("no time or no coordinates, no distances", () => {
  const untimed = {
    columnNames: ["latitude", "longitude", "sea_floor_depth"],
    columnTypes: ["float", "float", "float"],
    columnUnits: ["degrees_north", "degrees_east", "m"],
  };
  const unpositioned = {
    columnNames: ["time", "temperature"],
    columnTypes: ["String", "float"],
    columnUnits: ["UTC", "degree_C"],
  };
  for (const table of [untimed, unpositioned]) {
    assert.equal(
      trackDistancesFor(
        TRACK_DATASET,
        variablesFrom(table, TRACK_DATASET),
        OUT_OF_ORDER,
      ),
      null,
    );
  }
});

test("a dataset that publishes its own distance column keeps it", () => {
  const ownDistance = {
    columnNames: ["time", "latitude", "longitude", "total_distance_traveled"],
    columnTypes: ["String", "float", "float", "float"],
    columnUnits: ["UTC", "degrees_north", "degrees_east", "km"],
  };
  assert.equal(
    trackDistancesFor(
      TRACK_DATASET,
      variablesFrom(ownDistance, TRACK_DATASET),
      OUT_OF_ORDER,
    ),
    null,
  );
});

test("the synthetic variables are km coordinates, so never default panels", () => {
  const { variables } = distancesFor(OUT_OF_ORDER);
  assert.deepEqual(
    variables.map((variable) => variable.columnName),
    [TOTAL_DISTANCE_TRAVELED_COLUMN, EUCLIDEAN_DISTANCE_COLUMN],
  );
  variables.forEach((variable) => {
    assert.equal(variable.kind, "coordinate");
    assert.equal(variable.isNumeric, true);
    assert.equal(variable.unit, "km");
  });
  // The caller translates them; the module must not hard-code English.
  assert.deepEqual(
    variables.map((variable) => variable.longName),
    ["Total distance traveled", "Euclidean distance"],
  );
});

test("distanceRowsFor adds both columns in arrival order", () => {
  const rows = distanceRowsFor(OUT_OF_ORDER, distancesFor(OUT_OF_ORDER));
  assert.deepEqual(
    rows.map((row) => row.time),
    OUT_OF_ORDER.map((row) => row.time),
  );
  assertKilometres(
    rows.map((row) => row[TOTAL_DISTANCE_TRAVELED_COLUMN]),
    [DEGREE_KM, 2 * DEGREE_KM, 0],
  );
  assert.equal(distanceRowsFor(OUT_OF_ORDER, null), OUT_OF_ORDER);
});
