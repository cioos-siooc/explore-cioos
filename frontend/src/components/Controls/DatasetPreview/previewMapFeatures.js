import { splitAtAntimeridian } from "../../../utilities.jsx";
import { verticalCoordinate } from "./previewFacetPlan.js";
import {
  colorDimensionFor,
  colorScaleForVariable,
  legendTicksFor,
} from "./previewColorScales.js";
import { latitudeOf, longitudeOf } from "./previewTrackIndex.js";
import { labelFor } from "./previewVariables.js";

// Only tracks: a profile or a timeseries sits at one position, which the map's
// own markers already show.
const MAP_VIEW_TYPES = new Set(["Trajectory", "TrajectoryProfile"]);

// Grey, not dropped: the marker still says where the record went.
export const NO_VALUE_FILL = "rgba(128, 128, 128, 0.45)";

export function hasMapViewFor(dataset, variables) {
  return (
    MAP_VIEW_TYPES.has(dataset?.cdm_data_type) &&
    Boolean(latitudeOf(variables) && longitudeOf(variables))
  );
}

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null; // Number() reads these as 0
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const positionOf = (row, lon, lat) => {
  const x = finiteOrNull(row[lon.columnName]);
  const y = finiteOrNull(row[lat.columnName]);
  return x === null || y === null ? null : [x, y];
};

/**
 * The slider's extent for a TrajectoryProfile, or null for anything without a
 * vertical coordinate holding numbers.
 */
export function depthRangeFor(variables, data) {
  const variable = verticalCoordinate(variables);
  if (!variable) return null;
  let min = Infinity;
  let max = -Infinity;
  (data || []).forEach((row) => {
    const value = finiteOrNull(row[variable.columnName]);
    if (value === null) return;
    if (value < min) min = value;
    if (value > max) max = value;
  });
  return min <= max ? { variable, min, max } : null;
}

// One row per profile: the sample nearest `depth` that carries a value. A target
// outside the depths the profile reached has no answer — reaching for the
// closest would paint a 50 m cast's bottom value at 500 m.
function rowsAtDepth(rows, profileColumn, depthColumn, colorColumn, depth) {
  const profiles = new Map();
  rows.forEach((row) => {
    const key = profileColumn ? row[profileColumn] : "";
    if (!profiles.has(key)) profiles.set(key, []);
    profiles.get(key).push(row);
  });
  return [...profiles.values()].map((profileRows) => {
    const withValue = profileRows.filter(
      (row) =>
        row[colorColumn] !== null &&
        row[colorColumn] !== undefined &&
        row[colorColumn] !== "" &&
        finiteOrNull(row[depthColumn]) !== null,
    );
    const depths = withValue.map((row) => Number(row[depthColumn]));
    const inReach =
      depths.length > 0 &&
      depth >= Math.min(...depths) &&
      depth <= Math.max(...depths);
    if (!inReach) return { anchor: profileRows[0], picked: null };
    let picked = withValue[0];
    withValue.forEach((row, index) => {
      if (
        Math.abs(depths[index] - depth) <
        Math.abs(Number(picked[depthColumn]) - depth)
      ) {
        picked = row;
      }
    });
    return { anchor: profileRows[0], picked };
  });
}

// A MapLibre ramp over the dimension's range, from the same stops the legend
// paints. Inputs must strictly increase, so a palette repeating a position is
// thinned.
function rampExpression(stops, range) {
  if (!stops.length) return NO_VALUE_FILL;
  if (!range) return stops[Math.floor(stops.length / 2)][1];
  const [low, high] = range;
  const expression = ["interpolate", ["linear"], ["get", "v"]];
  let last = -Infinity;
  stops.forEach(([position, color]) => {
    const at = low + (high - low) * position;
    if (at <= last) return;
    expression.push(at, color);
    last = at;
  });
  return expression;
}

/**
 * Everything the map draws for one record and the panel beside it reads.
 *
 * `data` is plotData: in track order where the record has a time to order it
 * by. TrajectoryProfile is one marker per profile coloured at `depth`;
 * Trajectory is one marker per row. Markers with no value are left grey
 * rather than dropped, so the track still says where the record went.
 *
 * Returns null when no row has a position.
 */
export function previewMapLayerFor({
  dataset,
  variables,
  data,
  colorVariable,
  scaleName,
  depth,
}) {
  const lon = longitudeOf(variables);
  const lat = latitudeOf(variables);
  if (!lon || !lat || !data?.length) return null;

  const isProfiles = dataset?.cdm_data_type === "TrajectoryProfile";
  const depthRange = isProfiles ? depthRangeFor(variables, data) : null;
  const depthValue = depthRange
    ? Math.min(
        Math.max(depth ?? depthRange.min, depthRange.min),
        depthRange.max,
      )
    : null;

  let markers;
  if (depthRange && colorVariable) {
    const profileColumn = variables.find(
      (variable) => variable.cfRole === "profile_id",
    )?.columnName;
    markers = rowsAtDepth(
      data,
      profileColumn,
      depthRange.variable.columnName,
      colorVariable.columnName,
      depthValue,
    );
  } else {
    markers = data.map((row) => ({ anchor: row, picked: row }));
  }
  markers = markers
    .map((marker) => ({
      ...marker,
      position: positionOf(marker.anchor, lon, lat),
    }))
    .filter((marker) => marker.position);
  if (!markers.length) return null;

  const pickedRows = markers.map((marker) => marker.picked || {});
  const dimension = colorVariable
    ? colorDimensionFor(colorVariable, pickedRows)
    : null;
  const stops = colorVariable
    ? colorScaleForVariable(colorVariable, scaleName)
    : [];

  const pointFeatures = markers.map((marker, index) => {
    const value = marker.picked && dimension ? dimension.values[index] : null;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: marker.position },
      properties: value === null ? {} : { v: value },
    };
  });

  // Not splitTrackRuns: its 50 km outage rule is for harvested tracks, and
  // would cut every line between a ship's stations.
  const coordinates = markers.map((marker) => marker.position);
  const lineFeatures = splitAtAntimeridian(coordinates)
    .filter((run) => run.length >= 2)
    .map((run) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: run },
      properties: {},
    }));

  const longitudes = coordinates.map(([x]) => x);
  const latitudes = coordinates.map(([, y]) => y);

  return {
    data: {
      type: "FeatureCollection",
      features: [...lineFeatures, ...pointFeatures],
    },
    circleColor: [
      "case",
      ["has", "v"],
      rampExpression(stops, dimension?.range),
      NO_VALUE_FILL,
    ],
    bounds: [
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ],
    legend: dimension
      ? {
          label: labelFor(colorVariable),
          stops,
          ticks: legendTicksFor(dimension),
        }
      : null,
    depth: depthRange && { ...depthRange, value: depthValue },
    markerCount: markers.length,
    valueCount: pointFeatures.filter((feature) => "v" in feature.properties)
      .length,
  };
}
