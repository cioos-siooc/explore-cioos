// A trajectory's shared axis: the position's rank along the track, not one of
// its coordinates.
//
// WHY NOT LATITUDE OR LONGITUDE
// A coordinate only orders a track that never turns back: a survey revisiting a
// station gives two different moments the same x, and the line crosses itself.
// The rows do not even arrive in track order. So the axis is 1..N in TIME order,
// and the coordinates move to the tick labels and the hover, where both can be
// read at once — they stay in sharedCandidatesFor, one dropdown pick away.
//
// Pure: no React, no Plotly. The synthetic variable is shaped exactly like one
// of variablesFrom's, so every reader downstream treats it as an ordinary
// column.

// Chosen to read in a URL (?paxis=position_index). A dataset that already
// publishes a column of this name keeps it, and gets no index.
export const POSITION_INDEX_COLUMN = "position_index";

// Only tracks. A profile shares depth and a timeseries shares time; neither has
// positions to rank.
const INDEXED_TYPES = new Set(["Trajectory", "TrajectoryProfile"]);
// A profile's rows all sit at its one position, so they share one index.
const INDEXED_BY_POSITION = new Set(["TrajectoryProfile"]);

// Enough to label the axis without the labels touching each other: two lines of
// ~8 characters each, against a stacked panel's full width.
const MAX_TICKS = 8;
// ~11 m, which is finer than any of these datasets positions itself to.
const COORDINATE_DIGITS = 4;

const find = (variables, predicate) => (variables || []).find(predicate);

// Deliberately narrower than isTimeLike: that one also matches a "CCyy" year
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

export const latitudeOf = (variables) =>
  coordinateNamed(variables, "latitude", new Set(["latitude", "lat"]));

export const longitudeOf = (variables) =>
  coordinateNamed(variables, "longitude", new Set(["longitude", "lon"]));

// ERDDAP sends time as an ISO string, but a dataset whose units are epoch
// seconds sends a number; both are orderable, nothing else is.
function instantOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const formatCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return ""; // Number() reads these as 0
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
 * The input row indices sorted by time, or null when fewer than two rows carry
 * a readable time to order them by.
 */
export function timeOrderFor(variables, data) {
  const time = timeCoordinateOf(variables);
  if (!time || !data) return null;

  const instants = data.map((row) => instantOf(row[time.columnName]));
  if (instants.filter((instant) => instant !== null).length < 2) return null;

  // Stable, and a row with no readable time sorts last rather than anywhere:
  // it has no place on the track, and dropping it would hide data.
  return data
    .map((_, index) => index)
    .sort((left, right) => {
      const a = instants[left];
      const b = instants[right];
      if (a === b) return left - right;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
}

/**
 * The position index for this record, or null when it needs none.
 *
 * @param dataset   the record's dataset row (read for cdm_data_type)
 * @param variables from variablesFrom()
 * @param data      array of row objects, in the order /preview sent them
 * @param label     what to call the axis, translated by the caller
 *
 * Returns `{ variable, order, indexes, ticks, labels }`, where `order` holds
 * the input row indices sorted by time and everything else is in THAT order — so
 * positionRowsFor's rows, `indexes`, `ticks` and `labels` line up by
 * construction.
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

  const order = timeOrderFor(variables, data);
  if (!order) return null;

  const latitude = latitudeOf(variables);
  const longitude = longitudeOf(variables);

  const labels = order.map((rowIndex) => {
    if (!latitude || !longitude) return "";
    const north = formatCoordinate(data[rowIndex][latitude.columnName]);
    const east = formatCoordinate(data[rowIndex][longitude.columnName]);
    return north && east ? `${north}, ${east}` : "";
  });

  // One index per row, except where the type groups a position's rows together.
  // An unpositioned row always starts its own.
  const sharesPreviousIndex = (position) =>
    INDEXED_BY_POSITION.has(type) &&
    position > 0 &&
    labels[position] !== "" &&
    labels[position] === labels[position - 1];
  const indexes = [];
  const firstPositionOfIndex = [];
  labels.forEach((_, position) => {
    if (!sharesPreviousIndex(position)) firstPositionOfIndex.push(position);
    indexes.push(firstPositionOfIndex.length);
  });

  const tickIndexes = tickPositionsFor(firstPositionOfIndex.length);
  const ticks = {
    tickvals: tickIndexes.map((index) => index + 1),
    // Latitude over longitude, because a tick is narrow and a track is read
    // north-then-east. An unpositioned row labels its index alone.
    ticktext: tickIndexes.map((index) => {
      const label = labels[firstPositionOfIndex[index]];
      return label ? label.replace(", ", "<br>") : "";
    }),
  };

  return {
    variable: {
      columnName: POSITION_INDEX_COLUMN,
      unit: null,
      type: "int",
      isNumeric: true,
      longName: label,
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
      // a default panel, though either axis can pick it.
      kind: "coordinate",
    },
    order,
    indexes,
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
    [POSITION_INDEX_COLUMN]: trackIndex.indexes[position],
  }));
}
