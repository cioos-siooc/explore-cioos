import { test } from "node:test";
import assert from "node:assert/strict";

import { variablesFrom } from "./previewVariables.js";
import {
  POSITION_INDEX_COLUMN,
  positionRowsFor,
  timeCoordinateOf,
  trackIndexFor,
} from "./previewTrackIndex.js";
import { VIKING, VIKING_DATASET } from "./previewVariables.test.mjs";

const TRACK_DATASET = { ...VIKING_DATASET, cdm_data_type: "Trajectory" };

const variablesOf = (dataset = TRACK_DATASET) => variablesFrom(VIKING, dataset);

// Deliberately out of time order, the way ERDDAP returns a survey sorted by
// its sample id: the third row is the earliest.
const OUT_OF_ORDER = [
  { time: "2021-05-24T20:38:00Z", latitude: 47.57189, longitude: -69.85413 },
  { time: "2021-05-24T18:54:00Z", latitude: 47.590416, longitude: -69.8673 },
  { time: "2021-05-24T17:06:00Z", latitude: 47.615696, longitude: -69.9255 },
];

const indexFor = (data, dataset = TRACK_DATASET) =>
  trackIndexFor(dataset, variablesOf(dataset), data, "Position along track");

test("the index ranks the rows by time, not by the order they arrived", () => {
  const index = indexFor(OUT_OF_ORDER);
  assert.deepEqual(index.order, [2, 1, 0]);

  const rows = positionRowsFor(OUT_OF_ORDER, index);
  assert.deepEqual(
    rows.map((row) => row[POSITION_INDEX_COLUMN]),
    [1, 2, 3],
  );
  assert.deepEqual(
    rows.map((row) => row.time),
    ["2021-05-24T17:06:00Z", "2021-05-24T18:54:00Z", "2021-05-24T20:38:00Z"],
  );
});

test("rows sharing a timestamp keep the order they arrived in", () => {
  const sameInstant = [
    { time: "2021-05-24T17:06:00Z", latitude: 1, longitude: 1 },
    { time: "2021-05-24T17:06:00Z", latitude: 2, longitude: 2 },
    { time: "2021-05-24T16:00:00Z", latitude: 3, longitude: 3 },
  ];
  assert.deepEqual(indexFor(sameInstant).order, [2, 0, 1]);
});

test("a row with no readable time keeps its data and sorts last", () => {
  const withGap = [
    { time: "2021-05-24T20:38:00Z", latitude: 1, longitude: 1 },
    { time: null, latitude: 2, longitude: 2 },
    { time: "2021-05-24T17:06:00Z", latitude: 3, longitude: 3 },
  ];
  const index = indexFor(withGap);
  assert.deepEqual(index.order, [2, 0, 1]);
  assert.equal(positionRowsFor(withGap, index).length, 3);
});

test("every position carries its coordinates for the hover", () => {
  assert.deepEqual(indexFor(OUT_OF_ORDER).labels, [
    "47.6157, -69.9255",
    "47.5904, -69.8673",
    "47.5719, -69.8541",
  ]);
});

test("the ticks label latitude over longitude, one per position when they fit", () => {
  const { ticks } = indexFor(OUT_OF_ORDER);
  assert.deepEqual(ticks.tickvals, [1, 2, 3]);
  assert.deepEqual(ticks.ticktext, [
    "47.6157<br>-69.9255",
    "47.5904<br>-69.8673",
    "47.5719<br>-69.8541",
  ]);
});

test("a long track is labelled at eight positions, first and last included", () => {
  const long = Array.from({ length: 200 }, (_, index) => ({
    time: new Date(Date.UTC(2021, 4, 24, 0, index)).toISOString(),
    latitude: 45 + index / 1000,
    longitude: -60 - index / 1000,
  }));
  const { ticks } = indexFor(long);
  assert.equal(ticks.tickvals.length, 8);
  assert.equal(ticks.tickvals[0], 1);
  assert.equal(ticks.tickvals[7], 200);
  // Every tick names a position that exists, in ascending order.
  ticks.tickvals.forEach((value, at) => {
    assert.ok(value >= 1 && value <= 200);
    if (at) assert.ok(value > ticks.tickvals[at - 1]);
  });
});

test("a track with no coordinates is still indexed, with bare ticks", () => {
  const noPosition = [
    { time: "2021-05-24T17:06:00Z" },
    { time: "2021-05-24T18:54:00Z" },
  ];
  const index = indexFor(noPosition);
  assert.deepEqual(index.labels, ["", ""]);
  assert.deepEqual(index.ticks.ticktext, ["", ""]);
  assert.deepEqual(index.ticks.tickvals, [1, 2]);
});

test("the synthetic variable is a coordinate, so it is never a panel", () => {
  const { variable } = indexFor(OUT_OF_ORDER);
  assert.equal(variable.columnName, POSITION_INDEX_COLUMN);
  assert.equal(variable.kind, "coordinate");
  assert.equal(variable.isNumeric, true);
  assert.equal(variable.unit, null);
  // The caller translates it; the module must not hard-code English.
  assert.equal(variable.longName, "Position along track");
});

test("only a trajectory gets one", () => {
  for (const type of ["Profile", "TimeSeriesProfile", "TimeSeries", "Point"]) {
    assert.equal(
      indexFor(OUT_OF_ORDER, { ...VIKING_DATASET, cdm_data_type: type }),
      null,
      type,
    );
  }
});

test("no time column, no index — the old lon/lat axis has to answer", () => {
  const untimed = {
    columnNames: ["latitude", "longitude", "sea_floor_depth"],
    columnTypes: ["float", "float", "float"],
    columnUnits: ["degrees_north", "degrees_east", "m"],
  };
  assert.equal(
    trackIndexFor(
      TRACK_DATASET,
      variablesFrom(untimed, TRACK_DATASET),
      [
        { latitude: 1, longitude: 1 },
        { latitude: 2, longitude: 2 },
      ],
      "Position",
    ),
    null,
  );
});

test("a dataset that publishes its own position_index keeps it", () => {
  const ownIndex = {
    columnNames: ["time", "position_index", "temperature"],
    columnTypes: ["String", "int", "float"],
    columnUnits: ["UTC", null, "degree_C"],
  };
  assert.equal(
    trackIndexFor(
      TRACK_DATASET,
      variablesFrom(ownIndex, TRACK_DATASET),
      [
        { time: "2021-05-24T17:06:00Z", position_index: 7 },
        { time: "2021-05-24T18:54:00Z", position_index: 8 },
      ],
      "Position",
    ),
    null,
  );
});

test("one row is not a track", () => {
  assert.equal(indexFor(OUT_OF_ORDER.slice(0, 1)), null);
  assert.equal(indexFor([]), null);
});

test("positionRowsFor leaves the rows alone when there is no index", () => {
  assert.equal(positionRowsFor(OUT_OF_ORDER, null), OUT_OF_ORDER);
});

test("timeCoordinateOf finds the T axis and ignores a year column", () => {
  const withYear = {
    columnNames: ["year", "time", "latitude"],
    columnTypes: ["String", "String", "float"],
    columnUnits: ["CCyy", "UTC", "degrees_north"],
  };
  const variables = variablesFrom(withYear, TRACK_DATASET);
  assert.equal(timeCoordinateOf(variables).columnName, "time");
});
