// Layouts per cdm_data_type: profiles put panels side by side sharing a
// downward depth axis; timeseries/trajectories stack panels sharing one X, first
// variable at the bottom. Point needs no branch: the shared axis is excluded
// from the panels, so pointing it at a measurement gives "variable 1 on x".
//
// Pure (no React, no Plotly): DatasetPreview asks whether a plot is possible
// before mounting the lazy chunk.

import {
  idVariablesFor,
  isDownwardVertical,
  measurementsOf,
} from "./previewVariables.js";

export const COLUMNS = "columns"; // profiles: panels across, shared Y
export const ROWS = "rows"; // timeseries: panels stacked, shared X

const PROFILE_TYPES = new Set([
  "Profile",
  "TimeSeriesProfile",
  "TrajectoryProfile",
]);

const find = (variables, predicate) => variables.find(predicate);

const verticalCoordinate = (variables) =>
  find(
    variables,
    (variable) =>
      variable.kind === "coordinate" &&
      (variable.axis === "Z" ||
        variable.standardName === "depth" ||
        variable.standardName === "altitude" ||
        variable.columnName.toLowerCase() === "depth"),
  );

const timeCoordinate = (variables) =>
  find(
    variables,
    (variable) =>
      variable.kind === "coordinate" &&
      (variable.axis === "T" ||
        variable.standardName === "time" ||
        variable.unit === "UTC"),
  );

// Whichever of latitude / longitude moves more over the record: the other would
// collapse the plot onto a single value.
function trackCoordinate(variables, data) {
  const candidates = ["longitude", "latitude"]
    .map((standardName) =>
      find(
        variables,
        (variable) =>
          variable.kind === "coordinate" &&
          variable.standardName === standardName,
      ),
    )
    .filter(Boolean);
  if (candidates.length < 2 || !data || !data.length) return candidates[0];

  const spanOf = (variable) => {
    let min = Infinity;
    let max = -Infinity;
    data.forEach((row) => {
      const value = Number(row[variable.columnName]);
      if (!Number.isFinite(value)) return;
      if (value < min) min = value;
      if (value > max) max = value;
    });
    return max > min ? max - min : 0;
  };
  return spanOf(candidates[1]) > spanOf(candidates[0])
    ? candidates[1]
    : candidates[0];
}

// Coordinates first; measurements follow so "salinity against temperature"
// stays reachable.
export function sharedCandidatesFor(variables) {
  const coordinates = (variables || []).filter(
    (variable) => variable.kind === "coordinate",
  );
  return [...coordinates, ...measurementsOf(variables)];
}

function defaultSharedFor(dataset, variables, data) {
  const type = (dataset && dataset.cdm_data_type) || "";
  if (PROFILE_TYPES.has(type)) return verticalCoordinate(variables);
  if (type === "TimeSeries") return timeCoordinate(variables);
  if (type === "Trajectory") {
    return trackCoordinate(variables, data) || timeCoordinate(variables);
  }
  if (type === "Point") return measurementsOf(variables)[0];
  return undefined;
}

// The dataset's first EOV column when plottable, else the first measurement.
function defaultPanelsFor(dataset, variables, shared) {
  const measurements = measurementsOf(variables).filter(
    (variable) => !shared || variable.columnName !== shared.columnName,
  );
  if (!measurements.length) return [];
  const preferred =
    dataset &&
    dataset.first_eov_column &&
    measurements.find(
      (variable) => variable.columnName === dataset.first_eov_column,
    );
  return [(preferred || measurements[0]).columnName];
}

// null when this record cannot be plotted (Grid, unrecognised types).
export function facetPlanFor(dataset, variables, data) {
  if (!dataset || !variables || !variables.length) return null;
  const type = dataset.cdm_data_type || "";
  const orientation = PROFILE_TYPES.has(type) ? COLUMNS : ROWS;

  const shared = defaultSharedFor(dataset, variables, data);
  if (!shared) return null;

  const panelDefaults = defaultPanelsFor(dataset, variables, shared);
  if (!panelDefaults.length) return null;

  return {
    orientation,
    sharedAxis: shared.columnName,
    sharedReversed: orientation === COLUMNS && isDownwardVertical(shared),
    sharedCandidates: sharedCandidatesFor(variables).map(
      (variable) => variable.columnName,
    ),
    titleColumns: idVariablesFor(variables).map(
      (variable) => variable.columnName,
    ),
    panelDefaults,
  };
}

// A column named in a link that this dataset lacks is dropped, not drawn empty.
export function resolvePanels(panels, variables, sharedAxis) {
  const available = new Set(
    (variables || []).map((variable) => variable.columnName),
  );
  const seen = new Set();
  return (panels || []).filter((columnName) => {
    if (columnName === sharedAxis) return false;
    if (!available.has(columnName)) return false;
    if (seen.has(columnName)) return false;
    seen.add(columnName);
    return true;
  });
}

// Decided from cdm_data_type alone, never the payload: /preview is async, so a
// column-based default would bounce from "table" to "plot" once rows landed.
const PLOTTABLE_TYPES = new Set([
  ...PROFILE_TYPES,
  "TimeSeries",
  "Trajectory",
  "Point",
]);

export function defaultVisFor(dataset) {
  return PLOTTABLE_TYPES.has((dataset && dataset.cdm_data_type) || "")
    ? "plot"
    : "table";
}
