import { test } from "node:test";
import assert from "node:assert/strict";

import { variablesFrom } from "./previewVariables.js";
import {
  axisDirectionsFor,
  colorCandidatesFor,
  facetPlanFor,
  panelCandidatesFor,
  plotBlockerFor,
  PLOT_BLOCKED,
  sharedCandidatesFor,
  resolvePanels,
  defaultVisFor,
  COLUMNS,
  ROWS,
} from "./previewFacetPlan.js";
import {
  POSITION_INDEX_COLUMN,
  positionRowsFor,
  trackIndexFor,
} from "./previewTrackIndex.js";
import {
  VIKING,
  VIKING_NO_META,
  VIKING_DATASET,
} from "./previewVariables.test.mjs";

const TRACK_DATASET = { ...VIKING_DATASET, cdm_data_type: "Trajectory" };

const planFor = (type, table = VIKING, data) =>
  facetPlanFor(
    { ...VIKING_DATASET, cdm_data_type: type },
    variablesFrom(table, { ...VIKING_DATASET, cdm_data_type: type }),
    data,
  );

test("profile types face across, sharing a reversed depth axis", () => {
  for (const type of ["Profile", "TimeSeriesProfile", "TrajectoryProfile"]) {
    const plan = planFor(type);
    assert.equal(plan.orientation, COLUMNS, type);
    assert.equal(plan.sharedAxis, "depth", type);
    assert.equal(plan.sharedReversed, true, type);
  }
});

test("a timeseries stacks, sharing time, and is not reversed", () => {
  const plan = planFor("TimeSeries");
  assert.equal(plan.orientation, ROWS);
  assert.equal(plan.sharedAxis, "time");
  assert.equal(plan.sharedReversed, false);
});

test("a trajectory shares the position index when one was built", () => {
  const variables = variablesFrom(VIKING, TRACK_DATASET);
  const data = [
    { time: "2021-05-24T20:38:00Z", latitude: 47.57, longitude: -69.85 },
    { time: "2021-05-24T17:06:00Z", latitude: 47.61, longitude: -69.92 },
  ];
  const trackIndex = trackIndexFor(TRACK_DATASET, variables, data, "Position");
  const plan = facetPlanFor(
    TRACK_DATASET,
    [...variables, trackIndex.variable],
    positionRowsFor(data, trackIndex),
  );
  assert.equal(plan.orientation, ROWS);
  assert.equal(plan.sharedAxis, POSITION_INDEX_COLUMN);
  assert.equal(plan.sharedReversed, false);
  // Both coordinates stay offerable, so ?paxis=longitude still resolves and the
  // old axis is one dropdown pick away.
  assert.ok(plan.sharedCandidates.includes("longitude"));
  assert.ok(plan.sharedCandidates.includes("latitude"));
  // A coordinate, so it is never also a panel.
  assert.ok(!plan.panelDefaults.includes(POSITION_INDEX_COLUMN));
});

test("without an index a trajectory falls back to whichever of lon/lat moves", () => {
  // Mostly north-south: latitude spans 5 degrees, longitude 0.01.
  const northSouth = [
    { latitude: 45, longitude: -60.0 },
    { latitude: 50, longitude: -60.01 },
  ];
  assert.equal(
    planFor("Trajectory", VIKING, northSouth).sharedAxis,
    "latitude",
  );

  const eastWest = [
    { latitude: 45.0, longitude: -70 },
    { latitude: 45.01, longitude: -50 },
  ];
  assert.equal(planFor("Trajectory", VIKING, eastWest).sharedAxis, "longitude");
});

test("a trajectory with no rows yet still produces a plan", () => {
  // The payload is async; a plan that needed data would leave the first render
  // with nothing to draw and no axis names.
  const plan = planFor("Trajectory");
  assert.ok(plan);
  assert.ok(["longitude", "latitude"].includes(plan.sharedAxis));
});

test("Point shares its first measurement, and that column is not also a panel", () => {
  const plan = planFor("Point");
  assert.equal(plan.orientation, ROWS);
  assert.equal(plan.sharedAxis, "TE90_01");
  assert.ok(!plan.panelDefaults.includes("TE90_01"));
});

test("Grid and unknown types have no plan — the caller shows the table", () => {
  assert.equal(planFor("Grid"), null);
  assert.equal(planFor("Other"), null);
  assert.equal(planFor(""), null);
});

test("no variables means no plan", () => {
  assert.equal(facetPlanFor(VIKING_DATASET, [], undefined), null);
  assert.equal(facetPlanFor(VIKING_DATASET, undefined, undefined), null);
  assert.equal(
    facetPlanFor(undefined, variablesFrom(VIKING, VIKING_DATASET)),
    null,
  );
});

test("the default panel is the dataset first_eov_column when it is plottable", () => {
  assert.deepEqual(planFor("TimeSeriesProfile").panelDefaults, ["TE90_01"]);
});

test("an unplottable first_eov_column falls back to the first measurement", () => {
  const dataset = {
    ...VIKING_DATASET,
    cdm_data_type: "TimeSeriesProfile",
    first_eov_column: "station_id", // a cf_role id, never a panel
  };
  const plan = facetPlanFor(dataset, variablesFrom(VIKING, dataset));
  assert.deepEqual(plan.panelDefaults, ["TE90_01"]);
});

test("a plan exists before any harvest has filled columnMeta", () => {
  const plan = planFor("TimeSeriesProfile", VIKING_NO_META);
  assert.equal(plan.sharedAxis, "depth");
  assert.equal(plan.sharedReversed, true); // CF convention, no `positive` needed
  assert.deepEqual(plan.panelDefaults, ["TE90_01"]);
});

test("shared candidates lead with coordinates then offer every measurement", () => {
  const candidates = sharedCandidatesFor(
    variablesFrom(VIKING, VIKING_DATASET),
  ).map((v) => v.columnName);
  // Coordinates first, so the plausible answer is at the top of the dropdown...
  assert.deepEqual(candidates.slice(0, 6), [
    "time",
    "obs_lat",
    "obs_lon",
    "latitude",
    "longitude",
    "depth",
  ]);
  // ...but "salinity against temperature" stays reachable.
  assert.ok(candidates.includes("PSAL_01"));
  // Ids and flags are never offered.
  assert.ok(!candidates.includes("station_id"));
});

test("resolvePanels drops the shared axis, unknown columns and duplicates", () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET);
  assert.deepEqual(
    resolvePanels(
      ["TE90_01", "depth", "NOT_A_COLUMN", "PSAL_01", "TE90_01"],
      variables,
      "depth",
    ),
    ["TE90_01", "PSAL_01"],
  );
  assert.deepEqual(resolvePanels(undefined, variables, "depth"), []);
});

test("every variable the dataset has can be a panel at once", () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET);
  const all = [
    "TE90_01",
    "CNDC_01",
    "PRES_01",
    "PSAL_01",
    "FLOR_01",
    "DOXY_01",
  ];
  assert.deepEqual(resolvePanels(all, variables, "depth"), all);
});

test("vis default comes from the type alone, never the payload", () => {
  // Stability matters: /preview is async, so a default that read the columns
  // would answer "table" first and "plot" a moment later.
  for (const type of [
    "Profile",
    "TimeSeries",
    "TimeSeriesProfile",
    "Trajectory",
    "TrajectoryProfile",
    "Point",
  ]) {
    assert.equal(defaultVisFor({ cdm_data_type: type }), "plot", type);
  }
  assert.equal(defaultVisFor({ cdm_data_type: "Grid" }), "table");
  assert.equal(defaultVisFor({ cdm_data_type: "Other" }), "table");
  assert.equal(defaultVisFor(undefined), "table");
});

test("the plan names the cf_role columns, which is what titles the figure", () => {
  assert.deepEqual(planFor("TimeSeriesProfile").titleColumns, [
    "station_id",
    "profile",
  ]);
  // Independent of the layout: a stack is titled the same way.
  assert.deepEqual(planFor("TimeSeries").titleColumns, [
    "station_id",
    "profile",
  ]);
  // And independent of the harvest: without columnMeta the roles come from the
  // dataset's own timeseries/profile/trajectory id fields.
  assert.deepEqual(planFor("TimeSeriesProfile", VIKING_NO_META).titleColumns, [
    "station_id",
    "profile",
  ]);
});

test("the orientation decides which control runs horizontally", () => {
  // A profile draws its shared depth axis down the side, so that control is Y.
  assert.deepEqual(axisDirectionsFor(COLUMNS), {
    x: "vertical",
    y: "horizontal",
  });
  assert.deepEqual(axisDirectionsFor(ROWS), {
    x: "horizontal",
    y: "vertical",
  });
  assert.deepEqual(
    axisDirectionsFor(planFor("Profile").orientation),
    axisDirectionsFor(COLUMNS),
  );
  assert.deepEqual(
    axisDirectionsFor(planFor("Trajectory").orientation),
    axisDirectionsFor(ROWS),
  );
});

// --- why a record refuses to plot --------------------------------------------

const blockerFor = (type, table = VIKING, data) => {
  const dataset = { ...VIKING_DATASET, cdm_data_type: type };
  return plotBlockerFor(dataset, variablesFrom(table, dataset), data);
};

test("a record that plots is not also blocked", () => {
  for (const type of ["Profile", "TimeSeries", "Trajectory", "Point"]) {
    assert.ok(planFor(type), type);
    assert.equal(blockerFor(type), null, type);
  }
});

test("no columns at all is its own answer, not a complaint about the type", () => {
  const empty = { columnNames: [], columnTypes: [], columnUnits: [] };
  assert.equal(blockerFor("Profile", empty).code, PLOT_BLOCKED.NO_COLUMNS);
  assert.equal(
    plotBlockerFor(undefined, undefined, undefined).code,
    PLOT_BLOCKED.NO_COLUMNS,
  );
});

test("an unplottable cdm_data_type is named, blank or not", () => {
  const grid = blockerFor("Grid");
  assert.equal(grid.code, PLOT_BLOCKED.UNSUPPORTED_TYPE);
  assert.equal(grid.cdmDataType, "Grid");
  assert.equal(blockerFor("").cdmDataType, "");
});

test("a plottable type missing its shared axis says which column it wanted", () => {
  // The reported symptom: same type, one record plots and the next does not,
  // because this publisher's ERDDAP declares no vertical coordinate.
  const noDepth = {
    columnNames: ["station", "temperature"],
    columnTypes: ["String", "float"],
    columnUnits: [null, "degree_C"],
  };
  const profile = blockerFor("Profile", noDepth);
  assert.equal(profile.code, PLOT_BLOCKED.NO_SHARED_AXIS);
  assert.equal(profile.wanted, "vertical");
  assert.equal(profile.cdmDataType, "Profile");

  const noTime = {
    columnNames: ["depth", "temperature"],
    columnTypes: ["float", "float"],
    columnUnits: ["m", "degree_C"],
  };
  assert.equal(blockerFor("TimeSeries", noTime).wanted, "time");
  assert.equal(blockerFor("Trajectory", noTime).wanted, "track");
});

test("the columns the record DOES have are reported, to say what to fix", () => {
  const noDepth = {
    columnNames: ["station", "temperature"],
    columnTypes: ["String", "float"],
    columnUnits: [null, "degree_C"],
  };
  assert.deepEqual(blockerFor("Profile", noDepth).columns, [
    "station",
    "temperature",
  ]);
});

test("an axis but nothing to draw against it blames the measurements", () => {
  // Order matters: the shared axis resolves first, so a record with a depth
  // column and no measurement must not be reported as missing an axis.
  const idsOnly = {
    columnNames: ["depth", "station_id", "temperature_qc"],
    columnTypes: ["float", "String", "byte"],
    columnUnits: ["m", null, null],
  };
  const blocker = blockerFor("Profile", idsOnly);
  assert.equal(blocker.code, PLOT_BLOCKED.NO_MEASUREMENTS);
  assert.deepEqual(blocker.columns, ["depth", "station_id", "temperature_qc"]);
});

test("the colour dimension offers the shared axis's columns, time included", () => {
  const candidates = colorCandidatesFor(
    variablesFrom(VIKING, VIKING_DATASET),
  ).map((variable) => variable.columnName);
  assert.ok(candidates.includes("time"));
  assert.ok(candidates.includes("depth"));
  assert.ok(candidates.includes("TE90_01"));
});

test("a column no ramp can order is never offered as the colour dimension", () => {
  const candidates = colorCandidatesFor(
    variablesFrom(VIKING, VIKING_DATASET),
  ).map((variable) => variable.columnName);
  // Strings both, and station_id is an id besides.
  assert.ok(!candidates.includes("station_id"));
  assert.ok(!candidates.includes("profile"));
});

// ismerOsl002BathymetricProfilsPointeDesMonts, as ERDDAP publishes it: a
// transect whose measured quantity is the sea floor's depth and whose abscissa
// is the distance along it. Every numeric column here declares something that
// once read as a coordinate, which left the record with no panel at all.
const BATHYMETRY = {
  columnNames: [
    "profilID",
    "transectID",
    "time",
    "longitude",
    "latitude",
    "distance",
    "sea_floor_depth",
  ],
  columnTypes: [
    "String",
    "String",
    "String",
    "float",
    "float",
    "float",
    "float",
  ],
  columnUnits: [
    "unitless",
    "unitless",
    "UTC",
    "degrees_east",
    "degrees_north",
    "m",
    "m",
  ],
  columnMeta: [
    { name: "profilID", cf_role: "profile_id", ioos_category: "Identifier" },
    {
      name: "transectID",
      cf_role: "trajectory_id",
      ioos_category: "Identifier",
    },
    { name: "time", axis: "T", standard_name: "time", ioos_category: "Time" },
    {
      name: "longitude",
      axis: "X",
      standard_name: "longitude",
      ioos_category: "Location",
    },
    {
      name: "latitude",
      axis: "Y",
      standard_name: "latitude",
      ioos_category: "Location",
    },
    { name: "distance", long_name: "Distance", ioos_category: "Location" },
    {
      name: "sea_floor_depth",
      axis: "Z",
      standard_name: "sea_floor_depth_below_sea_surface",
      ioos_category: "Bathymetry",
    },
  ],
};
const BATHYMETRY_DATASET = {
  cdm_data_type: "TrajectoryProfile",
  profile_id_variable: "profilID",
  trajectory_id_variable: "transectID",
  first_eov_column: "sea_floor_depth",
};

test("a bathymetric transect is drawn rather than refused", () => {
  const variables = variablesFrom(BATHYMETRY, BATHYMETRY_DATASET);
  const plan = facetPlanFor(BATHYMETRY_DATASET, variables, []);
  assert.ok(plan, "the transect used to be blocked as noMeasurements");
  // Depth down the shared axis, distance across it: a cross-section. Not
  // reversed — the dataset's depths are already negative.
  assert.equal(plan.orientation, COLUMNS);
  assert.equal(plan.sharedAxis, "sea_floor_depth");
  assert.equal(plan.sharedReversed, false);
  assert.deepEqual(plan.panelDefaults, ["distance"]);
});

test("panelCandidatesFor offers the measurements, minus the shared axis", () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET);
  assert.deepEqual(
    panelCandidatesFor(variables, "TE90_01").map((v) => v.columnName),
    ["CNDC_01", "PRES_01", "PSAL_01", "FLOR_01", "DOXY_01"],
  );
});

test("panelCandidatesFor falls back to the vertical coordinate, never to position", () => {
  // With distance as the shared axis the transect has no measurement left, and
  // an empty panel picker is a dead end the axis dropdown can walk into.
  const variables = variablesFrom(BATHYMETRY, BATHYMETRY_DATASET);
  assert.deepEqual(
    panelCandidatesFor(variables, "distance").map((v) => v.columnName),
    ["sea_floor_depth"],
  );
  // Latitude and longitude say where, not what: never a panel.
  const offered = panelCandidatesFor(variables, "sea_floor_depth").map(
    (v) => v.columnName,
  );
  assert.deepEqual(offered, ["distance"]);
});
