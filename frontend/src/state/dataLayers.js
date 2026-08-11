// The data-type layers the map draws, and how a dataset row maps onto them.
//
// Three places need to agree on this: MapStateProvider (the state and its
// ?layers= round-trip), Map.jsx (the tile-query params) and SelectionProvider
// (which datasets the sidebar list shows). Keeping the key list and the
// key -> cdm_data_type mapping here is what makes the panel and the map show
// the same thing.

// Switch labels, in the order the switches render. The key order is also the
// order of the ?layers= comma list.
//
// These are the CF discrete-sampling geometries a dataset declares
// (cdm_data_type), which is why the filter calls itself "Dataset geometry" —
// the choice is about the SHAPE of the observations, not the subject matter.
// The order follows the taxonomy: the three that sample a fixed place, then
// the two that sample along a path, then the occurrence records. The two
// trajectory rows are kept adjacent because the track/hex display options
// render once, under the pair.
//
// 'trajectories' (plural) is the plain-Trajectory key. It keeps its old name
// so the ?layers= links already in the wild still resolve.
export const DATA_LAYER_LABEL_KEYS = {
  profile: 'layerProfile',
  timeseries: 'layerTimeseries',
  timeseriesProfile: 'layerTimeseriesProfile',
  trajectories: 'layerTrajectories',
  trajectoryProfile: 'layerTrajectoryProfile',
  obis: 'layerObis'
}

// The one-line hint under each label: what the geometry means in plain terms,
// and the platforms that typically produce it. Same keys as above.
export const DATA_LAYER_HINT_KEYS = {
  profile: 'layerProfileHint',
  timeseries: 'layerTimeseriesHint',
  timeseriesProfile: 'layerTimeseriesProfileHint',
  trajectories: 'layerTrajectoriesHint',
  trajectoryProfile: 'layerTrajectoryProfileHint',
  obis: 'layerObisHint'
}

// The two path-sampling geometries. They share every table and every map layer
// (coverage cells, track lines), so the switches differ only in which
// cdm_data_types they name on the wire — see TRAJECTORY_TYPE_KEYS.
export const TRAJECTORY_LAYER_KEYS = ['trajectories', 'trajectoryProfile']

// Is either path-sampling layer on? The track lines, the coverage hexes, the
// time scrub bar and the trajectory legend all belong to the pair rather than
// to one of them.
export const anyTrajectoryLayerOn = (dataLayers) =>
  !dataLayers || TRAJECTORY_LAYER_KEYS.some((key) => dataLayers[key])

export const DATA_LAYER_KEYS = Object.keys(DATA_LAYER_LABEL_KEYS)

export const ALL_DATA_LAYERS = Object.fromEntries(
  DATA_LAYER_KEYS.map((key) => [key, true])
)

// What a first visit shows. The three fixed-place geometries plus OBIS: the
// biodiversity occurrences are a headline part of what the catalog holds, and
// leaving them off meant a first visit under-reported the data by default.
// Both path-sampling geometries stay opt-in — they pull the heaviest tile set
// (track tiles on top of the coverage hexes) and bring the time scrub bar with
// them, which is a different mode of reading the map rather than one more layer
// on it. Off here means off everywhere — the map, the datasets panel and the
// counts (see datasetInDataLayers).
export const DEFAULT_DATA_LAYERS = {
  ...ALL_DATA_LAYERS,
  trajectories: false,
  trajectoryProfile: false
}

// How the trajectory layers draw when either is switched on. Track lines are
// the more legible first view of a voyage; the coverage hexes are the density
// reading you opt into on top. Both are independent — see the two sub-switches
// in DataLayersFilter — and these constants are also the state a trajectory
// switch restores when it is re-enabled.
export const DEFAULT_TRACKS_MODE = true
export const DEFAULT_TRAJECTORY_HEXES = false

// The cdm_data_types that share cde.profiles. The tile query names them
// directly (profileTypes=<comma list>), so this doubles as the wire mapping.
export const PROFILE_TYPE_KEYS = [
  ['profile', 'Profile'],
  ['timeseries', 'TimeSeries'],
  ['timeseriesProfile', 'TimeSeriesProfile']
]

// The cdm_data_types that share cde.trajectory_cells / cde.trajectory_points,
// same idea: the tile query names them as trajectoryTypes=<comma list>.
export const TRAJECTORY_TYPE_KEYS = [
  ['trajectories', 'Trajectory'],
  ['trajectoryProfile', 'TrajectoryProfile']
]

const TYPE_TO_KEY = new Map(
  [...PROFILE_TYPE_KEYS, ...TRAJECTORY_TYPE_KEYS].map(([key, type]) => [
    type,
    key
  ])
)

// Which switch governs a dataset, or undefined when none does. OBIS datasets
// carry cdm_data_type 'Point' — which an ERDDAP dataset can legitimately be
// too — so they're matched on source first, the same way SelectionProvider
// tells them apart. Grid datasets belong to no geometry layer: they have
// their own gridded-coverage switch, and the geometry selection never hides
// them.
export function dataLayerKeyForDataset (row) {
  if (row.source_type === 'obis') return 'obis'
  return TYPE_TO_KEY.get(row.cdm_data_type)
}

// Is this dataset drawn under the current layer selection?
export function datasetInDataLayers (row, dataLayers) {
  if (!dataLayers) return true
  const key = dataLayerKeyForDataset(row)
  return key === undefined || dataLayers[key] !== false
}

// Is every layer on? SelectionProvider uses this to skip per-row filtering
// entirely, so it stays a plain all-on test — it is NOT the default any more.
export const allDataLayersOn = (dataLayers) =>
  !dataLayers || Object.values(dataLayers).every(Boolean)

// Is this the default selection? Only a non-default selection is worth writing
// to the URL (see useUrlSync), and an absent ?layers= restores the default.
export const dataLayersAreDefault = (dataLayers) =>
  !dataLayers ||
  DATA_LAYER_KEYS.every(
    (key) => Boolean(dataLayers[key]) === DEFAULT_DATA_LAYERS[key]
  )
