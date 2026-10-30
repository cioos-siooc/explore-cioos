// Shared by MapStateProvider (?layers= round-trip), Map.jsx (tile-query
// params) and SelectionProvider (list narrowing) so all three agree.

// Key order is the ?layers= order and the render order (occurrence,
// fixed-place, path, gridded); the two trajectory rows stay adjacent because their
// display options render once under the pair. 'trajectories' keeps its old
// name so links in the wild resolve; LEGACY_DATA_LAYER_KEYS maps 'obis' to
// 'point'.
export const DATA_LAYER_LABEL_KEYS = {
  point: "layerPoint",
  profile: "layerProfile",
  timeseries: "layerTimeseries",
  timeseriesProfile: "layerTimeseriesProfile",
  trajectories: "layerTrajectories",
  trajectoryProfile: "layerTrajectoryProfile",
  grid: "layerGrid",
};

export const DATA_LAYER_HINT_KEYS = {
  point: "layerPointHint",
  profile: "layerProfileHint",
  timeseries: "layerTimeseriesHint",
  timeseriesProfile: "layerTimeseriesProfileHint",
  trajectories: "layerTrajectoriesHint",
  trajectoryProfile: "layerTrajectoryProfileHint",
  grid: "layerGridHint",
};

// They share every table and map layer, differing only in the cdm_data_types
// named on the wire (TRAJECTORY_TYPE_KEYS).
export const TRAJECTORY_LAYER_KEYS = ["trajectories", "trajectoryProfile"];

export const anyTrajectoryLayerOn = (dataLayers) =>
  !dataLayers || TRAJECTORY_LAYER_KEYS.some((key) => dataLayers[key]);

export const DATA_LAYER_KEYS = Object.keys(DATA_LAYER_LABEL_KEYS);

const LEGACY_DATA_LAYER_KEYS = { obis: "point" };

export const currentDataLayerKey = (key) => LEGACY_DATA_LAYER_KEYS[key] ?? key;

export const ALL_DATA_LAYERS = Object.fromEntries(
  DATA_LAYER_KEYS.map((key) => [key, true]),
);

// Like the catalogue filters, "nothing picked" means unfiltered, i.e. every
// geometry.
export const DEFAULT_DATA_LAYERS = ALL_DATA_LAYERS;

// Only a non-default selection is worth writing to the URL.
export const allDataLayersOn = (dataLayers) =>
  !dataLayers || DATA_LAYER_KEYS.every((key) => dataLayers[key]);

// {key: "include" | "exclude"}, unpicked keys absent.
export const toggledDataLayerChoice = (choice, target) =>
  choice === target ? undefined : target;

// Drawn = one of the included geometries (or any, when none is included) and
// not an excluded one.
export function dataLayersFromChoices(choices) {
  const anyIncluded = DATA_LAYER_KEYS.some((key) => choices[key] === "include");
  return Object.fromEntries(
    DATA_LAYER_KEYS.map((key) => [
      key,
      choices[key] !== "exclude" &&
        (!anyIncluded || choices[key] === "include"),
    ]),
  );
}

export const chosenDataLayerKeys = (choices) =>
  DATA_LAYER_KEYS.filter((key) => choices[key]);

// On by default: the lines are the more legible first view of a voyage.
export const DEFAULT_TRACKS_MODE = true;

// The tile query names them directly (profileTypes=), so this doubles as the
// wire mapping.
export const PROFILE_TYPE_KEYS = [
  ["profile", "Profile"],
  ["timeseries", "TimeSeries"],
  ["timeseriesProfile", "TimeSeriesProfile"],
];

// Named on the wire as trajectoryTypes=.
export const TRAJECTORY_TYPE_KEYS = [
  ["trajectories", "Trajectory"],
  ["trajectoryProfile", "TrajectoryProfile"],
];

// Point is OBIS occurrences today; an ERDDAP Point dataset would join the same
// switch once the harvester admits the type.
const TYPE_TO_KEY = new Map([
  ...[...PROFILE_TYPE_KEYS, ...TRAJECTORY_TYPE_KEYS].map(([key, type]) => [
    type,
    key,
  ]),
  ["Point", "point"],
  ["Grid", "grid"],
]);

// undefined when no switch governs it. griddapCoverageVisible is map
// appearance, independent of this filter.
export function dataLayerKeyForDataset(row) {
  return TYPE_TO_KEY.get(row.cdm_data_type);
}

// So a type reads the same on cards, group headings and the coverage chart as
// in the filter.
export function cdmDataTypeLabel(type, t) {
  const key = dataLayerKeyForDataset({ cdm_data_type: type });
  return key ? t(DATA_LAYER_LABEL_KEYS[key]) : type;
}

export function datasetInDataLayers(row, dataLayers) {
  if (!dataLayers) return true;
  const key = dataLayerKeyForDataset(row);
  return key === undefined || dataLayers[key] !== false;
}
