import { describe, it, expect } from "vitest";

import { buildTileSuffix } from "./tileQuery.js";
import {
  ALL_DATA_LAYERS,
  onlyDataLayer,
  PROFILE_TYPE_KEYS,
  TRAJECTORY_TYPE_KEYS,
} from "../../state/dataLayers.js";
import { HEX_METRIC } from "../config";

const params = (suffix) => new URLSearchParams(suffix);

describe("the metric is always on the wire", () => {
  it("writes it even for an empty query and no layers", () => {
    // The API counts something else when the param is absent, so its presence
    // is not an optimisation — it is the contract.
    expect(buildTileSuffix("", undefined)).toBe(`?metric=${HEX_METRIC}`);
  });

  it("overrides a metric the caller's query string already carried", () => {
    expect(
      params(buildTileSuffix("metric=bogus", undefined)).getAll("metric"),
    ).toEqual([HEX_METRIC]);
  });

  it("keeps the filter's own params alongside it", () => {
    const got = params(
      buildTileSuffix("timeMin=2020-01-01&eovs=oxygen", undefined),
    );
    expect(got.get("timeMin")).toBe("2020-01-01");
    expect(got.get("eovs")).toBe("oxygen");
  });
});

describe("a fully-on selection adds no narrowing params", () => {
  it("emits only the metric", () => {
    expect(buildTileSuffix("", ALL_DATA_LAYERS)).toBe(`?metric=${HEX_METRIC}`);
  });

  it("names no type lists, so the URL stays clean", () => {
    const got = params(buildTileSuffix("", ALL_DATA_LAYERS));
    expect(got.has("profileTypes")).toBe(false);
    expect(got.has("trajectoryTypes")).toBe(false);
    expect(got.has("includeObis")).toBe(false);
    expect(got.has("includeTrajectory")).toBe(false);
  });
});

describe("OBIS is off unless its layer is on", () => {
  it("adds includeObis=false when the layer is off", () => {
    expect(
      params(buildTileSuffix("", onlyDataLayer("profile"))).get("includeObis"),
    ).toBe("false");
  });

  it("keeps a false the Source filter already emitted, even with the layer on", () => {
    // The two switches are OR-ed: Source=ERDDAP-only and the OBIS layer on
    // must not re-admit OBIS.
    const got = params(buildTileSuffix("includeObis=false", ALL_DATA_LAYERS));
    expect(got.get("includeObis")).toBe("false");
  });

  it("does not add the param when only the layer is on and the filter is silent", () => {
    expect(
      params(buildTileSuffix("", onlyDataLayer("obis"))).has("includeObis"),
    ).toBe(false);
  });
});

describe("a narrowed geometry subset names its cdm_data_types", () => {
  it("lists the one profile type left", () => {
    const got = params(buildTileSuffix("", onlyDataLayer("timeseries")));
    expect(got.get("profileTypes")).toBe("TimeSeries");
  });

  it("lists the one trajectory type left", () => {
    const got = params(buildTileSuffix("", onlyDataLayer("trajectories")));
    expect(got.get("trajectoryTypes")).toBe("Trajectory");
  });

  it("uses the wire names from dataLayers, not the layer keys", () => {
    // The keys are UI identifiers; the params carry ERDDAP's cdm_data_type.
    const got = params(buildTileSuffix("", onlyDataLayer("timeseriesProfile")));
    expect(got.get("profileTypes")).toBe("TimeSeriesProfile");
    expect(PROFILE_TYPE_KEYS).toContainEqual([
      "timeseriesProfile",
      "TimeSeriesProfile",
    ]);
  });

  it("joins several kept types with commas, in declaration order", () => {
    const layers = { ...ALL_DATA_LAYERS, profile: false };
    expect(params(buildTileSuffix("", layers)).get("profileTypes")).toBe(
      "TimeSeries,TimeSeriesProfile",
    );
  });
});

describe("no trajectory geometry means none, not all", () => {
  it("sends an empty list and the explicit off switch", () => {
    // An empty trajectoryTypes is 'none'. includeTrajectory=false rides along
    // so a reader of the URL cannot mistake the empty list for 'unset'.
    const got = params(buildTileSuffix("", onlyDataLayer("profile")));
    expect(got.get("trajectoryTypes")).toBe("");
    expect(got.get("includeTrajectory")).toBe("false");
  });

  it("does not send the off switch while one trajectory type survives", () => {
    const got = params(buildTileSuffix("", onlyDataLayer("trajectoryProfile")));
    expect(got.get("trajectoryTypes")).toBe("TrajectoryProfile");
    expect(got.has("includeTrajectory")).toBe(false);
  });

  it("treats every trajectory layer off as none, however it got there", () => {
    const layers = Object.fromEntries(
      Object.keys(ALL_DATA_LAYERS).map((key) => [
        key,
        !TRAJECTORY_TYPE_KEYS.some(([k]) => k === key),
      ]),
    );
    expect(params(buildTileSuffix("", layers)).get("includeTrajectory")).toBe(
      "false",
    );
  });
});
