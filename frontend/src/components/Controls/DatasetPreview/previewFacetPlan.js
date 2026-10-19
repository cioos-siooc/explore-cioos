// What to draw for a record: the axis every panel shares, which way the panels
// stack, and the default panels. CDM_LAYOUTS below holds one row per
// cdm_data_type, after CDE_Graphs_SANDBOX.png.
//
// Pure (no React, no Plotly): DatasetPreview asks whether a plot is possible
// before mounting the lazy chunk.

import {
  idVariablesFor,
  isDownwardVertical,
  isTimeLike,
  measurementsOf,
} from "./previewVariables.js";
import {
  POSITION_INDEX_COLUMN,
  timeCoordinateOf,
} from "./previewTrackIndex.js";
import {
  EUCLIDEAN_DISTANCE_COLUMN,
  TOTAL_DISTANCE_TRAVELED_COLUMN,
} from "./previewTrackDistance.js";

export const COLUMNS = "columns"; // profiles: panels across, shared Y
export const ROWS = "rows"; // timeseries: panels stacked, shared X

const find = (variables, predicate) => (variables || []).find(predicate);

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

// The index when trackIndexFor built one, which is the usual case. Without it —
// a track with no time to rank by — the coordinate that moves furthest is still
// a better axis than nothing.
function trackAxisFor(variables, data) {
  return (
    find(
      variables,
      (variable) => variable.columnName === POSITION_INDEX_COLUMN,
    ) ||
    trackCoordinate(variables, data) ||
    timeCoordinateOf(variables)
  );
}

// The computed axes a track offers, in the order the axis lists show them.
const TRACK_AXIS_COLUMNS = [
  POSITION_INDEX_COLUMN,
  TOTAL_DISTANCE_TRAVELED_COLUMN,
  EUCLIDEAN_DISTANCE_COLUMN,
];
const trackLeadingAxes = (variables) =>
  TRACK_AXIS_COLUMNS.map((columnName) =>
    find(variables, (variable) => variable.columnName === columnName),
  );
const timeLeadingAxis = (variables) => [timeCoordinateOf(variables)];

// One row per plottable cdm_data_type: how its panels stack, which axis they
// share, which columns head the axis lists, and what the search was looking for
// when a record has none. A seventh type is one row here and nowhere else —
// this table is what `defaultVisFor` means by plottable and what the blocker
// message names.
//
// Point needs nothing beyond its first measurement: the shared axis is always
// excluded from the panel set, so "variable 1 on x, the rest as panels" falls
// out of pointing the shared axis at a measurement.
const CDM_LAYOUTS = {
  Profile: {
    orientation: COLUMNS,
    wanted: "vertical",
    sharedAxisFor: verticalCoordinate,
  },
  TimeSeriesProfile: {
    orientation: COLUMNS,
    wanted: "vertical",
    sharedAxisFor: verticalCoordinate,
    leadingAxesFor: timeLeadingAxis,
  },
  TrajectoryProfile: {
    orientation: COLUMNS,
    wanted: "vertical",
    sharedAxisFor: verticalCoordinate,
    leadingAxesFor: trackLeadingAxes,
  },
  TimeSeries: {
    orientation: ROWS,
    wanted: "time",
    sharedAxisFor: timeCoordinateOf,
    leadingAxesFor: timeLeadingAxis,
  },
  Trajectory: {
    orientation: ROWS,
    wanted: "track",
    sharedAxisFor: trackAxisFor,
    leadingAxesFor: trackLeadingAxes,
  },
  Point: {
    orientation: ROWS,
    wanted: "measurement",
    sharedAxisFor: (variables) => measurementsOf(variables)[0],
  },
};

const layoutFor = (dataset) =>
  CDM_LAYOUTS[(dataset && dataset.cdm_data_type) || ""] || null;

// Which direction each axis control runs in, which picks its caption: X is
// always the horizontal one and Y the vertical one. A profile's shared depth
// axis is the vertical one with the panels across it, a trajectory's shared
// track axis is the horizontal one with the panels stacked up it.
export function axisDirectionsFor(orientation) {
  return orientation === COLUMNS
    ? { x: "vertical", y: "horizontal" }
    : { x: "horizontal", y: "vertical" };
}

const coordinatesOf = (variables) =>
  (variables || []).filter((variable) => variable.kind === "coordinate");

// Every column, each once, in the order given.
const uniqueColumns = (variables) => [
  ...new Map(
    variables
      .filter(Boolean)
      .map((variable) => [variable.columnName, variable]),
  ).values(),
];

// Every column offerable as the shared axis, most plausible first: the type's
// own leading axes, then the coordinates the layouts assume, then the
// measurements so "salinity against temperature" stays reachable, then the rest
// (ids, flags, text), which Plotly draws as categories.
export function sharedCandidatesFor(variables, dataset) {
  const layout = layoutFor(dataset);
  const leading =
    layout && layout.leadingAxesFor ? layout.leadingAxesFor(variables) : [];
  return uniqueColumns([
    ...leading,
    ...coordinatesOf(variables),
    ...measurementsOf(variables),
    ...(variables || []),
  ]);
}

// What can carry the colour dimension: the coordinates and measurements a ramp
// can order — a station id says nothing by sorting after another one. Time
// stays: it is TEXT in ERDDAP's JSON rather than a number, and it is the most
// useful third dimension a profile or a track has.
export function colorCandidatesFor(variables) {
  return [...coordinatesOf(variables), ...measurementsOf(variables)].filter(
    (variable) => variable.isNumeric || isTimeLike(variable),
  );
}

// The colour plot's X and Y when the link names neither: every panel draws Y
// against X and is shaded by its own variable, so the two are the record's
// "where" — time (or the track) across, depth down. A profile's shared axis is
// already that depth, a stack's is already that time.
export function colorPlotAxesFor(dataset, variables, plan) {
  if (!plan) return { x: null, y: null };
  const layout = layoutFor(dataset);
  const panelDefaults = plan.panelDefaults || [];
  if (plan.orientation === COLUMNS) {
    const leading =
      layout && layout.leadingAxesFor
        ? layout.leadingAxesFor(variables).filter(Boolean)
        : [];
    const across = leading[0] || timeCoordinateOf(variables);
    return { x: (across && across.columnName) || null, y: plan.sharedAxis };
  }
  const notTaken = (variable) =>
    variable.columnName !== plan.sharedAxis &&
    !panelDefaults.includes(variable.columnName);
  const down =
    verticalCoordinate(variables) || measurementsOf(variables).find(notTaken);
  return {
    x: plan.sharedAxis,
    y: down && down.columnName !== plan.sharedAxis ? down.columnName : null,
  };
}

// Where a measurement was taken, never what it measured. Excluded from the
// fallback below: a transect plotted against its own longitude says nothing the
// map is not already showing.
const isHorizontalPosition = (variable) =>
  variable.axis === "X" ||
  variable.axis === "Y" ||
  variable.standardName === "latitude" ||
  variable.standardName === "longitude";

// Every column this record can put in a panel, given the axis the panels share:
// the measurements first, as the usual pick, then everything else.
export function panelCandidatesFor(variables, sharedAxis, dataset) {
  return uniqueColumns([
    ...measurementsOf(variables),
    ...sharedCandidatesFor(variables, dataset),
  ]).filter((variable) => variable.columnName !== sharedAxis);
}

// What a record opens on, given the axis the panels share.
//
// Normally the measurements, which is what `measurement` means. The fallback is
// for a record that MEASURES ITS OWN VERTICAL COORDINATE — ismerOsl002 sounds a
// transect, so its quantity is sea_floor_depth (axis Z, hence a coordinate) and
// its abscissa is distance. Such a record has no measurement left once the
// depth becomes the shared axis, and refusing to draw it was wrong: the
// coordinate is the data. Only reached when the primary list is empty, so a
// record with measurements is untouched.
function defaultPanelCandidatesFor(variables, sharedAxis) {
  const notShared = (variable) =>
    !sharedAxis || variable.columnName !== sharedAxis;
  const measurements = measurementsOf(variables).filter(notShared);
  if (measurements.length) return measurements;
  return (variables || []).filter(
    (variable) =>
      variable.kind === "coordinate" &&
      variable.isNumeric &&
      notShared(variable) &&
      !isHorizontalPosition(variable),
  );
}

// The dataset's first EOV column when plottable, else the first candidate.
function defaultPanelsFor(dataset, variables, shared) {
  const candidates = defaultPanelCandidatesFor(
    variables,
    shared && shared.columnName,
  );
  if (!candidates.length) return [];
  const preferred =
    dataset &&
    dataset.first_eov_column &&
    candidates.find(
      (variable) => variable.columnName === dataset.first_eov_column,
    );
  return [(preferred || candidates[0]).columnName];
}

// Why a record has no plan. Four codes rather than one "not plottable", because
// two records of the SAME cdm_data_type routinely differ: one publisher's ERDDAP
// declares the coordinate metadata and the next one's does not, and only the
// code says which column was missing.
export const PLOT_BLOCKED = {
  NO_COLUMNS: "noColumns",
  UNSUPPORTED_TYPE: "unsupportedType",
  NO_SHARED_AXIS: "noSharedAxis",
  NO_MEASUREMENTS: "noMeasurements",
};

// One walk, two readings: the plan when there is one, otherwise what stopped it.
// Shared so the answer and the excuse can never disagree about what is missing.
function planOrBlockerFor(dataset, variables, data) {
  const columns = (variables || []).map((variable) => variable.columnName);
  const cdmDataType = (dataset && dataset.cdm_data_type) || "";
  const blocked = (code, rest) => ({
    blocker: { code, cdmDataType, columns, ...rest },
  });

  if (!dataset || !variables || !variables.length) {
    return blocked(PLOT_BLOCKED.NO_COLUMNS);
  }
  const layout = layoutFor(dataset);
  if (!layout) {
    return blocked(PLOT_BLOCKED.UNSUPPORTED_TYPE);
  }

  const shared = layout.sharedAxisFor(variables, data);
  if (!shared) {
    return blocked(PLOT_BLOCKED.NO_SHARED_AXIS, { wanted: layout.wanted });
  }

  const panelDefaults = defaultPanelsFor(dataset, variables, shared);
  if (!panelDefaults.length) return blocked(PLOT_BLOCKED.NO_MEASUREMENTS);

  return {
    plan: planFrom(
      dataset,
      layout.orientation,
      shared,
      variables,
      panelDefaults,
    ),
  };
}

// What stopped this record from being plotted, or null when nothing did.
export function plotBlockerFor(dataset, variables, data) {
  return planOrBlockerFor(dataset, variables, data).blocker || null;
}

// null when this record cannot be plotted — the caller shows the table, which is
// what Grid and any unrecognised cdm_data_type get, and plotBlockerFor above
// says which of the four reasons applied.
export function facetPlanFor(dataset, variables, data) {
  return planOrBlockerFor(dataset, variables, data).plan || null;
}

function planFrom(dataset, orientation, shared, variables, panelDefaults) {
  return {
    orientation,
    sharedAxis: shared.columnName,
    sharedReversed: orientation === COLUMNS && isDownwardVertical(shared),
    sharedCandidates: sharedCandidatesFor(variables, dataset).map(
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

// Table or plot when the link says nothing. Decided from cdm_data_type alone,
// never the payload: /preview is async, so a column-based default would bounce
// from "table" to "plot" once rows landed. A plottable type with no plottable
// column is reported by plotBlockerFor instead.
export function defaultVisFor(dataset) {
  return layoutFor(dataset) ? "plot" : "table";
}
