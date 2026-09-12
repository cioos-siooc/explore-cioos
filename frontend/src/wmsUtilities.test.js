import { describe, expect, it } from "vitest";

import {
  buildWmsOverlay,
  getTimeDimension,
  gridAxisNodes,
  withLiveTimeDimension,
} from "./wmsUtilities";

const harvested = [
  {
    name: "time",
    n_values: 10,
    min: "2024-01-01T00:00:00Z",
    max: "2024-01-10T00:00:00Z",
    spacing: "1 day",
    even_spacing: true,
    units: "seconds since 1970-01-01T00:00:00Z",
  },
  { name: "latitude", n_values: 100, min: 40, max: 50 },
];

const nodesOf = (dimension) =>
  gridAxisNodes(
    Date.parse(dimension.min),
    Date.parse(dimension.max),
    dimension.n_values,
  );

describe("withLiveTimeDimension", () => {
  it("keeps the harvested dimensions when there is no live axis", () => {
    expect(withLiveTimeDimension(harvested, null)).toBe(harvested);
    expect(withLiveTimeDimension(harvested, undefined)).toBe(harvested);
  });

  it("substitutes the live bounds and count together, preserving the step", () => {
    // The whole point: gridAxisNodes derives step as (max-min)/(count-1), so
    // advancing `max` without `n_values` would stretch every step and put each
    // marker between slices rather than on one.
    const live = {
      name: "time",
      n_values: 13,
      min: "2024-01-04T00:00:00Z",
      max: "2024-01-16T00:00:00Z",
      even_spacing: true,
    };
    const next = withLiveTimeDimension(harvested, live);
    const time = getTimeDimension(next);

    expect(time.max).toBe("2024-01-16T00:00:00Z");
    expect(time.min).toBe("2024-01-04T00:00:00Z");
    expect(time.n_values).toBe(13);
    expect(nodesOf(time).step).toBe(nodesOf(harvested[0]).step);
  });

  it("leaves the harvested dimensions object untouched", () => {
    // The inspector's axis cards and GridNodeCount present grid_dimensions as
    // harvested fact; only the overlay descriptor may carry the live axis.
    const live = { name: "time", n_values: 13, max: "2024-01-16T00:00:00Z" };
    withLiveTimeDimension(harvested, live);
    expect(harvested[0].max).toBe("2024-01-10T00:00:00Z");
    expect(harvested[0].n_values).toBe(10);
  });

  it("falls back to the harvested value for anything the server omits", () => {
    const next = withLiveTimeDimension(harvested, {
      name: "time",
      max: "2024-01-16T00:00:00Z",
      n_values: null,
      units: undefined,
    });
    const time = getTimeDimension(next);
    expect(time.max).toBe("2024-01-16T00:00:00Z");
    expect(time.n_values).toBe(10);
    expect(time.units).toBe(harvested[0].units);
    expect(time.spacing).toBe("1 day");
  });

  it("is a no-op for a grid with no time axis", () => {
    const static_ = [{ name: "latitude", n_values: 100, min: 40, max: 50 }];
    expect(withLiveTimeDimension(static_, { name: "time", max: "x" })).toBe(
      static_,
    );
  });
});

describe("buildWmsOverlay", () => {
  const dataset = {
    pk: "1",
    dataset_id: "someGrid",
    title: "Some grid",
    wms_url: "https://example.org/erddap/wms/someGrid/request",
    erddap_url: "https://example.org/erddap",
    grid_dimensions: harvested,
    grid_variables: [{ name: "chlorophyll", eovs: ["chlorophyll"] }],
  };

  it("defaults the displayed slice to the newest node the server reports", () => {
    const overlay = buildWmsOverlay(dataset, [], undefined, {
      name: "time",
      n_values: 13,
      min: "2024-01-04T00:00:00Z",
      max: "2024-01-16T00:00:00Z",
    });
    expect(overlay.time).toBe("2024-01-16T00:00:00Z");
    expect(getTimeDimension(overlay.dimensions).n_values).toBe(13);
  });

  it("falls back to the harvested newest node without a live axis", () => {
    expect(buildWmsOverlay(dataset, [], undefined, null).time).toBe(
      "2024-01-10T00:00:00Z",
    );
  });

  it("still honours a share link's remembered slice", () => {
    const overlay = buildWmsOverlay(
      dataset,
      [],
      { time: "2024-01-06T00:00:00Z" },
      { name: "time", n_values: 13, max: "2024-01-16T00:00:00Z" },
    );
    expect(overlay.time).toBe("2024-01-06T00:00:00Z");
  });
});
