import {
  ALL_DATA_LAYERS,
  DATA_LAYER_KEYS,
  DEFAULT_DATA_LAYERS,
  allDataLayersOn,
  anyTrajectoryLayerOn,
  chosenDataLayerKeys,
  dataLayerKeyForDataset,
  dataLayersFromChoices,
  datasetInDataLayers,
  nextDataLayerChoice,
} from "./dataLayers.js";

const onlyDataLayer = (key) => dataLayersFromChoices({ [key]: "include" });

describe("the unfiltered state is everything-on", () => {
  it("defaults to every geometry, which is what no picks draws", () => {
    expect(DEFAULT_DATA_LAYERS).toEqual(ALL_DATA_LAYERS);
    expect(dataLayersFromChoices({})).toEqual(ALL_DATA_LAYERS);
    expect(chosenDataLayerKeys({})).toEqual([]);
  });

  it("treats an absent selection as everything-on", () => {
    // MapStateProvider hands undefined through before ?layers= is resolved.
    expect(allDataLayersOn(undefined)).toBe(true);
    expect(anyTrajectoryLayerOn(undefined)).toBe(true);
  });
});

describe("choices, like every other list filter", () => {
  it("cycles include -> exclude -> clear", () => {
    expect(nextDataLayerChoice(undefined)).toBe("include");
    expect(nextDataLayerChoice("include")).toBe("exclude");
    expect(nextDataLayerChoice("exclude")).toBeUndefined();
  });

  it("draws only the included geometries once any is included", () => {
    const drawn = dataLayersFromChoices({ obis: "include", grid: "include" });
    expect(DATA_LAYER_KEYS.filter((key) => drawn[key])).toEqual([
      "obis",
      "grid",
    ]);
  });

  it("draws everything but the excluded ones when none is included", () => {
    const drawn = dataLayersFromChoices({ grid: "exclude" });
    expect(drawn.grid).toBe(false);
    expect(DATA_LAYER_KEYS.filter((key) => drawn[key])).toHaveLength(
      DATA_LAYER_KEYS.length - 1,
    );
  });

  it("includes and excludes combine", () => {
    const drawn = dataLayersFromChoices({ obis: "include", grid: "exclude" });
    expect(drawn.obis).toBe(true);
    expect(drawn.grid).toBe(false);
    expect(drawn.profile).toBe(false);
  });

  it("lists the picked geometries in render order", () => {
    expect(
      chosenDataLayerKeys({ grid: "exclude", profile: "include" }),
    ).toEqual(["profile", "grid"]);
  });
});

describe("anyTrajectoryLayerOn", () => {
  it("is true while either path-sampling geometry is on", () => {
    expect(anyTrajectoryLayerOn(onlyDataLayer("trajectories"))).toBe(true);
    expect(anyTrajectoryLayerOn(onlyDataLayer("trajectoryProfile"))).toBe(true);
  });

  it("is false once neither is", () => {
    // The track lines, coverage hexes, scrub bar and trajectory legend all
    // belong to the pair, so this gates all four.
    expect(anyTrajectoryLayerOn(onlyDataLayer("profile"))).toBe(false);
  });
});

describe("mapping a dataset row onto a switch", () => {
  it("matches OBIS on source before cdm_data_type", () => {
    // OBIS rows carry cdm_data_type 'Point', which an ERDDAP dataset can be too.
    expect(
      dataLayerKeyForDataset({ source_type: "obis", cdm_data_type: "Point" }),
    ).toBe("obis");
  });

  it("maps the profile and trajectory cdm_data_types", () => {
    expect(dataLayerKeyForDataset({ cdm_data_type: "Profile" })).toBe(
      "profile",
    );
    expect(dataLayerKeyForDataset({ cdm_data_type: "TimeSeries" })).toBe(
      "timeseries",
    );
    expect(dataLayerKeyForDataset({ cdm_data_type: "TimeSeriesProfile" })).toBe(
      "timeseriesProfile",
    );
    expect(dataLayerKeyForDataset({ cdm_data_type: "Trajectory" })).toBe(
      "trajectories",
    );
    expect(dataLayerKeyForDataset({ cdm_data_type: "TrajectoryProfile" })).toBe(
      "trajectoryProfile",
    );
    expect(dataLayerKeyForDataset({ cdm_data_type: "Grid" })).toBe("grid");
  });

  it("governs nothing for an unrecognised geometry", () => {
    expect(dataLayerKeyForDataset({ cdm_data_type: "Point" })).toBeUndefined();
  });

  it("admits a dataset no switch governs, whatever the selection", () => {
    // Otherwise narrowing to one geometry would silently drop rows the filter
    // has no opinion about.
    const row = { cdm_data_type: "Point" };
    expect(datasetInDataLayers(row, onlyDataLayer("grid"))).toBe(true);
  });

  it("admits only the datasets whose switch is on", () => {
    const grid = { cdm_data_type: "Grid" };
    const profile = { cdm_data_type: "Profile" };
    const selection = onlyDataLayer("grid");
    expect(datasetInDataLayers(grid, selection)).toBe(true);
    expect(datasetInDataLayers(profile, selection)).toBe(false);
  });
});
