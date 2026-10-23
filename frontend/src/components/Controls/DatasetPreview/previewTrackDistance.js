// A track's two distance axes: the total distance traveled, and the euclidean
// (great-circle) distance from where it started. Both in km, over the loaded
// rows only — /preview sends the newest window, so "start" is the first loaded
// position, not the cruise's.
//
// Great-circle, never projected: within ~0.5% of the ellipsoid at any length,
// where Mercator doubles distances by 60°N and UTM only holds inside one zone.
//
// Pure: no React, no Plotly. The synthetic variables are shaped like
// trackIndexFor's, so every reader downstream treats them as ordinary columns.

import turfDistance from "@turf/distance";

import { latitudeOf, longitudeOf, timeOrderFor } from "./previewTrackIndex.js";

export const TOTAL_DISTANCE_TRAVELED_COLUMN = "total_distance_traveled";
export const EUCLIDEAN_DISTANCE_COLUMN = "euclidean_distance";

// A TrajectoryProfile's rows share one position per profile; the distance only
// moves between profiles, which is what a section is read against.
const DISTANCE_TYPES = new Set(["Trajectory", "TrajectoryProfile"]);

function positionOf(row, latitude, longitude) {
  const north = Number(row[latitude.columnName]);
  const east = Number(row[longitude.columnName]);
  const isValid =
    row[latitude.columnName] !== null &&
    row[longitude.columnName] !== null &&
    Number.isFinite(north) &&
    Number.isFinite(east);
  return isValid ? [east, north] : null;
}

const distanceVariable = (columnName, label) => ({
  columnName,
  unit: "km",
  type: "double",
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
  // Not "measurement": never a default panel, though either axis can pick it.
  kind: "coordinate",
});

/**
 * Both distances for this record, or null when it has none.
 *
 * @param dataset   the record's dataset row (read for cdm_data_type)
 * @param variables from variablesFrom()
 * @param data      array of row objects, in the order /preview sent them
 * @param labels    `{ totalDistanceTraveled, euclideanDistance }`, translated
 *                  by the caller
 *
 * Returns `{ variables, totalDistanceTraveled, euclideanDistance }`, the two
 * arrays indexed like `data`. A row with no position gets null in both, and the
 * total carries on from the last position before it.
 */
export function trackDistancesFor(
  dataset,
  variables,
  data,
  labels = {
    totalDistanceTraveled: "Total distance traveled",
    euclideanDistance: "Euclidean distance",
  },
) {
  const type = (dataset && dataset.cdm_data_type) || "";
  if (!DISTANCE_TYPES.has(type)) return null;
  if (!data || data.length < 2) return null;
  if (
    (variables || []).some(
      (variable) =>
        variable.columnName === TOTAL_DISTANCE_TRAVELED_COLUMN ||
        variable.columnName === EUCLIDEAN_DISTANCE_COLUMN,
    )
  ) {
    return null;
  }

  const latitude = latitudeOf(variables);
  const longitude = longitudeOf(variables);
  if (!latitude || !longitude) return null;

  const order = timeOrderFor(variables, data);
  if (!order) return null;

  const totalDistanceTraveled = new Array(data.length).fill(null);
  const euclideanDistance = new Array(data.length).fill(null);
  let start = null;
  let previous = null;
  let total = 0;
  order.forEach((rowIndex) => {
    const position = positionOf(data[rowIndex], latitude, longitude);
    if (!position) return;
    if (!start) start = position;
    if (previous) total += turfDistance(previous, position);
    totalDistanceTraveled[rowIndex] = total;
    euclideanDistance[rowIndex] = turfDistance(start, position);
    previous = position;
  });
  if (!start) return null;

  return {
    variables: [
      distanceVariable(
        TOTAL_DISTANCE_TRAVELED_COLUMN,
        labels.totalDistanceTraveled,
      ),
      distanceVariable(EUCLIDEAN_DISTANCE_COLUMN, labels.euclideanDistance),
    ],
    totalDistanceTraveled,
    euclideanDistance,
  };
}

// `data` with both distances on each row, in the order it arrived.
export function distanceRowsFor(data, trackDistances) {
  if (!trackDistances) return data;
  return data.map((row, rowIndex) => ({
    ...row,
    [TOTAL_DISTANCE_TRAVELED_COLUMN]:
      trackDistances.totalDistanceTraveled[rowIndex],
    [EUCLIDEAN_DISTANCE_COLUMN]: trackDistances.euclideanDistance[rowIndex],
  }));
}
