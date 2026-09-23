// A trajectory's shared axis: the position's rank along the track, not one of
// its coordinates.
//
// WHY NOT LATITUDE OR LONGITUDE
// The layout image says a trajectory is read against its track, and the first
// reading of that was max([lat],[lon]) — whichever coordinate spans further.
// That only works on a track that never turns back: a survey that revisits a
// station gives two different moments the same x, and the line crosses itself.
// The rows do not even arrive in track order — IsmerOslKamouraskaGeochemistry's
// Mai21 comes back in sampleID order, whose first row is 20:38 and second 18:54.
//
// So the axis becomes 1..N in TIME order, and the coordinates move to the tick
// labels and the hover, where two of them can be read at once. Latitude and
// longitude stay in sharedCandidatesFor, so the old axis is one dropdown pick
// away.
//
// Pure: no React, no Plotly. The synthetic variable is shaped exactly like one
// of variablesFrom's, so every reader downstream — the axis picker, the label
// editor, the colour candidates — treats it as an ordinary column.

// Chosen to read in a URL (?paxis=position_index). A dataset that already
// publishes a column of this name keeps it, and gets no index.
export const POSITION_INDEX_COLUMN = "position_index";

// Only tracks. A profile shares depth and a timeseries shares time; neither has
// positions to rank.
const INDEXED_TYPES = new Set(["Trajectory"]);

// Enough to label the axis without the labels touching each other: two lines of
// ~8 characters each, against a stacked panel's full width.
const MAX_TICKS = 8;
// ~11 m, which is finer than any of these datasets positions itself to.
const COORDINATE_DIGITS = 4;

const find = (variables, predicate) => (variables || []).find(predicate);

// Verbatim the predicate previewFacetPlan used before this module existed, and
// deliberately narrower than isTimeLike: that one also matches a "CCyy" year
// column, which orders a track far more coarsely than its timestamps do.
export function timeCoordinateOf(variables) {
  return find(
    variables,
    (variable) =>
      variable.kind === "coordinate" &&
      (variable.axis === "T" ||
        variable.standardName === "time" ||
        variable.unit === "UTC"),
  );
}

function coordinateNamed(variables, standardName, fallbackNames) {
  return find(
    variables,
    (variable) =>
      variable.kind === "coordinate" &&
      (variable.standardName === standardName ||
        fallbackNames.has((variable.columnName || "").toLowerCase())),
  );
}

// ERDDAP sends time as an ISO string, but a dataset whose units are epoch
// seconds sends a number; both are orderable, nothing else is.
function instantOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const formatCoordinate = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(COORDINATE_DIGITS) : "";
};

// At most MAX_TICKS positions, always including the first and the last.
function tickPositionsFor(count) {
  if (count <= MAX_TICKS) {
    return Array.from({ length: count }, (_, index) => index);
  }
  const step = (count - 1) / (MAX_TICKS - 1);
  return Array.from({ length: MAX_TICKS }, (_, index) =>
    Math.round(index * step),
  );
}

/**
 * The position index for this record, or null when it needs none.
 *
 * @param dataset   the record's dataset row (read for cdm_data_type)
 * @param variables from variablesFrom()
 * @param data      array of row objects, in the order /preview sent them
 * @param label     what to call the axis, translated by the caller
 *
 * Returns `{ variable, order, ticks, labels }`, where `order` holds the input
 * row indices sorted by time and everything else is in THAT order — so
 * positionRowsFor's rows, `ticks` and `labels` line up by construction.
 */
export function trackIndexFor(dataset, variables, data, label = "Position") {
  const type = (dataset && dataset.cdm_data_type) || "";
  if (!INDEXED_TYPES.has(type)) return null;
  if (!data || data.length < 2) return null;
  if (
    (variables || []).some(
      (variable) => variable.columnName === POSITION_INDEX_COLUMN,
    )
  ) {
    return null;
  }

  const time = timeCoordinateOf(variables);
  if (!time) return null;

  const instants = data.map((row) => instantOf(row[time.columnName]));
  if (instants.filter((instant) => instant !== null).length < 2) return null;

  // Stable, and a row with no readable time sorts last rather than anywhere:
  // it has no place on the track, and dropping it would hide data.
  const order = data
    .map((_, index) => index)
    .sort((left, right) => {
      const a = instants[left];
      const b = instants[right];
      if (a === b) return left - right;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });

  const latitude = coordinateNamed(
    variables,
    "latitude",
    new Set(["latitude", "lat"]),
  );
  const longitude = coordinateNamed(
    variables,
    "longitude",
    new Set(["longitude", "lon"]),
  );

  const labels = order.map((rowIndex) => {
    if (!latitude || !longitude) return "";
    const north = formatCoordinate(data[rowIndex][latitude.columnName]);
    const east = formatCoordinate(data[rowIndex][longitude.columnName]);
    return north && east ? `${north}, ${east}` : "";
  });

  const positions = tickPositionsFor(order.length);
  const ticks = {
    tickvals: positions.map((position) => position + 1),
    // Latitude over longitude, because a tick is narrow and a track is read
    // north-then-east. An unpositioned row labels its index alone.
    ticktext: positions.map((position) =>
      labels[position] ? labels[position].replace(", ", "<br>") : "",
    ),
  };

  return {
    variable: {
      columnName: POSITION_INDEX_COLUMN,
      unit: null,
      type: "int",
      isNumeric: true,
      longName: label,
      genericName: null,
      originalName: null,
      standardName: null,
      cfRole: null,
      axis: null,
      positive: null,
      ioosCategory: null,
      palette: null,
      colorBarScale: null,
      cmin: undefined,
      cmax: undefined,
      // Not "measurement": this keeps it out of measurementsOf, so it is never
      // offered as a panel while staying offerable as the shared axis.
      kind: "coordinate",
    },
    order,
    ticks,
    labels,
  };
}

/**
 * The rows the figure draws: `data` in track order, each carrying its index.
 *
 * The table keeps the unreordered rows — its columns come from the response's
 * own columnNames, so it never sees this column either.
 */
export function positionRowsFor(data, trackIndex) {
  if (!trackIndex) return data;
  return trackIndex.order.map((rowIndex, position) => ({
    ...data[rowIndex],
    [POSITION_INDEX_COLUMN]: position + 1,
  }));
}
