// What to draw for a record: which axis every panel shares, which way the panels
// stack, and which variables get a panel by default. CDM_LAYOUTS below holds the
// whole vocabulary, one row per cdm_data_type, after CDE_Graphs_SANDBOX.png.
//
// Pure: no React, no Plotly. DatasetPreview asks whether a plot is possible at
// all before mounting the lazy chunk, and this is what answers.

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

// Whichever of latitude / longitude actually moves over the record. The image
// writes this as max([lat],[lon]): a north-south track is best read against
// latitude, an east-west one against longitude, and picking the wrong one
// collapses the plot onto a single value.
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

// One row per plottable cdm_data_type: how its panels stack, which axis they
// share, and what the search was looking for when a record has none. A seventh
// type is one row here and nowhere else — this table is what `defaultVisFor`
// means by plottable and what the blocker message names.
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
  },
  TrajectoryProfile: {
    orientation: COLUMNS,
    wanted: "vertical",
    sharedAxisFor: verticalCoordinate,
  },
  TimeSeries: {
    orientation: ROWS,
    wanted: "time",
    sharedAxisFor: timeCoordinateOf,
  },
  Trajectory: {
    orientation: ROWS,
    wanted: "track",
    sharedAxisFor: trackAxisFor,
  },
  Point: {
    orientation: ROWS,
    wanted: "measurement",
    sharedAxisFor: (variables) => measurementsOf(variables)[0],
  },
};

const layoutFor = (dataset) =>
  CDM_LAYOUTS[(dataset && dataset.cdm_data_type) || ""] || null;

// Which way round the two axis controls are drawn. X is the axis every panel is
// drawn against and Y is the panels themselves, in BOTH layouts — the names are
// about the data, so they do not swap when the panels do. What the orientation
// decides is the direction each one runs in: a profile's shared depth axis is
// the vertical one with the panels across it, a trajectory's shared track axis
// is the horizontal one with the panels stacked up it.
export function axisDirectionsFor(orientation) {
  return orientation === COLUMNS
    ? { x: "vertical", y: "horizontal" }
    : { x: "horizontal", y: "vertical" };
}

// Columns offerable as the shared axis, most plausible first. Coordinates lead
// because they are what the layouts assume; every measurement follows so
// "salinity against temperature" stays reachable, which is the whole point of
// keeping the axis overridable.
export function sharedCandidatesFor(variables) {
  const coordinates = (variables || []).filter(
    (variable) => variable.kind === "coordinate",
  );
  return [...coordinates, ...measurementsOf(variables)];
}

// What can carry the colour dimension: the same columns the shared axis offers,
// less the ones a ramp cannot order — a station id says nothing by sorting after
// another one. Time stays: it is TEXT in ERDDAP's JSON rather than a number, and
// it is the most useful third dimension a profile or a track has.
export function colorCandidatesFor(variables) {
  return sharedCandidatesFor(variables).filter(
    (variable) => variable.isNumeric || isTimeLike(variable),
  );
}

// Where a measurement was taken, never what it measured. Excluded from the
// fallback below: a transect plotted against its own longitude says nothing the
// map is not already showing.
const isHorizontalPosition = (variable) =>
  variable.axis === "X" ||
  variable.axis === "Y" ||
  variable.standardName === "latitude" ||
  variable.standardName === "longitude";

// What this record can put in a panel, given the axis the panels share.
//
// Normally the measurements, which is what `measurement` means. The fallback is
// for a record that MEASURES ITS OWN VERTICAL COORDINATE — ismerOsl002 sounds a
// transect, so its quantity is sea_floor_depth (axis Z, hence a coordinate) and
// its abscissa is distance. Such a record has no measurement left once the
// depth becomes the shared axis, and refusing to draw it was wrong: the
// coordinate is the data. Only reached when the primary list is empty, so a
// record with measurements is untouched.
export function panelCandidatesFor(variables, sharedAxis) {
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

// The panels a record opens on: the dataset's own first EOV column when it is
// plottable, else the first candidate. One panel, matching what the preview
// showed before faceting.
function defaultPanelsFor(dataset, variables, shared) {
  const candidates = panelCandidatesFor(variables, shared && shared.columnName);
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
    plan: planFrom(layout.orientation, shared, variables, panelDefaults),
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

function planFrom(orientation, shared, variables, panelDefaults) {
  return {
    orientation,
    sharedAxis: shared.columnName,
    // A depth axis runs downwards; nothing else is reversed.
    sharedReversed: orientation === COLUMNS && isDownwardVertical(shared),
    sharedCandidates: sharedCandidatesFor(variables).map(
      (variable) => variable.columnName,
    ),
    // What names the record: the cf_role columns, which the figure turns into
    // its title. Here rather than in the figure because this is the module that
    // answers "what is drawn", and because it keeps the figure's inputs to a
    // plan plus a payload.
    titleColumns: idVariablesFor(variables).map(
      (variable) => variable.columnName,
    ),
    panelDefaults,
  };
}

// Resolve a plan against the user's choices. The shared axis is never also a
// panel, and a column named in a link that this dataset does not have is
// dropped rather than drawn empty.
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

// Table or plot when the link says nothing. Deliberately decided from cdm_data_type ALONE, never from the payload: the
// /preview fetch is async, so a default that consulted the columns would answer
// "table" on the first render and "plot" once the rows landed, bouncing the user
// between views mid-load. The type is what says whether a layout exists at all;
// a plottable type with no plottable column is rare and better reported by the
// plot than by silently reverting to the table — see plotBlockerFor, which is
// what reports it.
export function defaultVisFor(dataset) {
  return layoutFor(dataset) ? "plot" : "table";
}
