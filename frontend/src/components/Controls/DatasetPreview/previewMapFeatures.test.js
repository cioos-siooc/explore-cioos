import { describe, it, expect } from "vitest";

import {
  depthRangeFor,
  hasMapViewFor,
  NO_VALUE_FILL,
  previewMapLayerFor,
} from "./previewMapFeatures.js";

const coordinate = (columnName, standardName, extra = {}) => ({
  columnName,
  standardName,
  kind: "coordinate",
  isNumeric: true,
  ...extra,
});
const LON = coordinate("longitude", "longitude", { axis: "X" });
const LAT = coordinate("latitude", "latitude", { axis: "Y" });
const TIME = coordinate("time", "time", {
  axis: "T",
  isNumeric: false,
  unit: "UTC",
});
const DEPTH = coordinate("depth", "depth", { axis: "Z", positive: "down" });
const TEMP = {
  columnName: "temp",
  longName: "Temperature",
  unit: "degC",
  kind: "measurement",
  isNumeric: true,
};
const PROFILE = {
  columnName: "cast",
  cfRole: "profile_id",
  kind: "id",
  isNumeric: false,
};

const TRAJECTORY = { cdm_data_type: "Trajectory" };
const TRAJECTORY_PROFILE = { cdm_data_type: "TrajectoryProfile" };

const points = (layer) =>
  layer.data.features.filter((f) => f.geometry.type === "Point");
const lines = (layer) =>
  layer.data.features.filter((f) => f.geometry.type === "LineString");

describe("hasMapViewFor", () => {
  it("offers the map for track types that publish a position", () => {
    expect(hasMapViewFor(TRAJECTORY, [LON, LAT])).toBe(true);
    expect(hasMapViewFor(TRAJECTORY_PROFILE, [LON, LAT])).toBe(true);
  });

  it("refuses types sitting at one position, and tracks without lat/lon", () => {
    expect(hasMapViewFor({ cdm_data_type: "Profile" }, [LON, LAT])).toBe(false);
    expect(hasMapViewFor(TRAJECTORY, [LON])).toBe(false);
    expect(hasMapViewFor(undefined, [LON, LAT])).toBe(false);
  });
});

describe("previewMapLayerFor — Trajectory", () => {
  const variables = [TIME, LON, LAT, TEMP];
  const data = [
    { time: "2024-01-01T00:00:00Z", longitude: -63, latitude: 44, temp: 4 },
    { time: "2024-01-01T01:00:00Z", longitude: -62.9, latitude: 44.1, temp: 6 },
    {
      time: "2024-01-01T02:00:00Z",
      longitude: -62.8,
      latitude: 44.2,
      temp: null,
    },
  ];
  const layer = previewMapLayerFor({
    dataset: TRAJECTORY,
    variables,
    data,
    colorVariable: TEMP,
  });

  it("draws one marker per row, valued where the colour column holds one", () => {
    expect(points(layer).map((f) => f.properties)).toEqual([
      { v: 4 },
      { v: 6 },
      {},
    ]);
    expect(layer.markerCount).toBe(3);
    expect(layer.valueCount).toBe(2);
  });

  it("joins the markers into a line and frames them", () => {
    expect(lines(layer)).toHaveLength(1);
    expect(lines(layer)[0].geometry.coordinates).toHaveLength(3);
    expect(layer.bounds).toEqual([
      [-63, 44],
      [-62.8, 44.2],
    ]);
  });

  it("ramps over the values' range and leaves the gaps grey", () => {
    const [, has, ramp, fallback] = layer.circleColor;
    expect(has).toEqual(["has", "v"]);
    expect(ramp.slice(0, 3)).toEqual(["interpolate", ["linear"], ["get", "v"]]);
    expect(ramp[3]).toBe(4);
    expect(ramp[ramp.length - 2]).toBe(6);
    expect(fallback).toBe(NO_VALUE_FILL);
    expect(layer.legend.label).toBe("Temperature ( degC )");
    expect(layer.depth).toBeNull();
  });

  it("colours by time as epoch milliseconds", () => {
    const byTime = previewMapLayerFor({
      dataset: TRAJECTORY,
      variables,
      data,
      colorVariable: TIME,
    });
    expect(points(byTime)[0].properties.v).toBe(
      Date.parse("2024-01-01T00:00:00Z"),
    );
  });

  it("breaks the line at the antimeridian", () => {
    const crossing = previewMapLayerFor({
      dataset: TRAJECTORY,
      variables: [LON, LAT, TEMP],
      data: [
        { longitude: 179.5, latitude: 50, temp: 1 },
        { longitude: 179.9, latitude: 50, temp: 1 },
        { longitude: -179.9, latitude: 50, temp: 1 },
        { longitude: -179.5, latitude: 50, temp: 1 },
      ],
      colorVariable: TEMP,
    });
    expect(lines(crossing)).toHaveLength(2);
  });

  it("skips rows without a position, and answers null when none has one", () => {
    const partial = previewMapLayerFor({
      dataset: TRAJECTORY,
      variables,
      data: [
        ...data,
        { time: "2024-01-01T03:00:00Z", longitude: "", latitude: 44 },
      ],
      colorVariable: TEMP,
    });
    expect(partial.markerCount).toBe(3);
    expect(
      previewMapLayerFor({
        dataset: TRAJECTORY,
        variables,
        data: [{ longitude: null, latitude: null }],
        colorVariable: TEMP,
      }),
    ).toBeNull();
  });

  it("paints a single value in one colour rather than a degenerate ramp", () => {
    const flat = previewMapLayerFor({
      dataset: TRAJECTORY,
      variables,
      data: data.map((row) => ({ ...row, temp: 5 })),
      colorVariable: TEMP,
    });
    expect(typeof flat.circleColor[2]).toBe("string");
  });
});

describe("previewMapLayerFor — TrajectoryProfile", () => {
  const variables = [PROFILE, TIME, LON, LAT, DEPTH, TEMP];
  const cast = (id, lon, time, samples) =>
    samples.map(([depth, temp]) => ({
      cast: id,
      time,
      longitude: lon,
      latitude: 45,
      depth,
      temp,
    }));
  const data = [
    ...cast("a", -60, "2024-01-01T00:00:00Z", [
      [0, 10],
      [10, 8],
      [50, 4],
    ]),
    ...cast("b", -59, "2024-01-02T00:00:00Z", [
      [0, 12],
      [20, 9],
    ]),
  ];

  it("spans the slider over every depth sampled", () => {
    expect(depthRangeFor(variables, data)).toMatchObject({ min: 0, max: 50 });
  });

  it("draws one marker per profile, coloured by its nearest sample", () => {
    const layer = previewMapLayerFor({
      dataset: TRAJECTORY_PROFILE,
      variables,
      data,
      colorVariable: TEMP,
      depth: 12,
    });
    expect(points(layer).map((f) => f.properties.v)).toEqual([8, 9]);
    expect(layer.depth).toMatchObject({ min: 0, max: 50, value: 12 });
    expect(lines(layer)).toHaveLength(1);
  });

  it("leaves a profile grey below the deepest depth it reached", () => {
    const layer = previewMapLayerFor({
      dataset: TRAJECTORY_PROFILE,
      variables,
      data,
      colorVariable: TEMP,
      depth: 40,
    });
    expect(points(layer).map((f) => f.properties)).toEqual([{ v: 4 }, {}]);
    expect(layer.valueCount).toBe(1);
  });

  it("opens at the shallowest depth and clamps a depth out of range", () => {
    const opened = previewMapLayerFor({
      dataset: TRAJECTORY_PROFILE,
      variables,
      data,
      colorVariable: TEMP,
    });
    expect(opened.depth.value).toBe(0);
    expect(points(opened).map((f) => f.properties.v)).toEqual([10, 12]);
    const clamped = previewMapLayerFor({
      dataset: TRAJECTORY_PROFILE,
      variables,
      data,
      colorVariable: TEMP,
      depth: 900,
    });
    expect(clamped.depth.value).toBe(50);
  });
});
