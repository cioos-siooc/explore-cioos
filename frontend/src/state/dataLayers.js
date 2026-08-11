// The data-type layers the map draws, and how a dataset row maps onto them.
//
// Three places need to agree on this: MapStateProvider (the state and its
// ?layers= round-trip), Map.jsx (the tile-query params) and SelectionProvider
// (which datasets the sidebar list shows). Keeping the key list and the
// key -> cdm_data_type mapping here is what makes the panel and the map show
// the same thing.

// Switch labels, in the order the switches render. The key order is also the
// order of the ?layers= comma list.
export const DATA_LAYER_LABEL_KEYS = {
  profile: 'layerProfile',
  timeseries: 'layerTimeseries',
  timeseriesProfile: 'layerTimeseriesProfile',
  obis: 'layerObis',
  trajectories: 'layerTrajectories'
}

export const DATA_LAYER_KEYS = Object.keys(DATA_LAYER_LABEL_KEYS)

export const ALL_DATA_LAYERS = Object.fromEntries(
  DATA_LAYER_KEYS.map((key) => [key, true])
)

// What a first visit shows. The three profile-family types plus OBIS: the
// biodiversity occurrences are a headline part of what the catalog holds, and
// leaving them off meant a first visit under-reported the data by default.
// Trajectories stay opt-in — they pull the heaviest tile set of the five (track
// tiles on top of the coverage hexes) and bring the time scrub bar with them,
// which is a different mode of reading the map rather than one more layer on
// it. Off here means off everywhere — the map, the datasets panel and the
// counts (see datasetInDataLayers).
export const DEFAULT_DATA_LAYERS = {
  ...ALL_DATA_LAYERS,
  trajectories: false
}

// How the trajectories layer draws when it is switched on. Track lines are the
// more legible first view of a voyage; the coverage hexes are the density
// reading you opt into on top. Both are independent — see the two sub-switches
// in AppShell — and these constants are also the state the parent switch
// restores when it is re-enabled.
export const DEFAULT_TRACKS_MODE = true
export const DEFAULT_TRAJECTORY_HEXES = false

// The cdm_data_types that share cde.profiles. The tile query names them
// directly (profileTypes=<comma list>), so this doubles as the wire mapping.
export const PROFILE_TYPE_KEYS = [
  ['profile', 'Profile'],
  ['timeseries', 'TimeSeries'],
  ['timeseriesProfile', 'TimeSeriesProfile']
]

const PROFILE_TYPE_TO_KEY = new Map(
  PROFILE_TYPE_KEYS.map(([key, type]) => [type, key])
)

const TRAJECTORY_TYPES = new Set(['Trajectory', 'TrajectoryProfile'])

// Which switch governs a dataset, or undefined when none does. OBIS datasets
// carry cdm_data_type 'Point' — which an ERDDAP dataset can legitimately be
// too — so they're matched on source first, the same way SelectionProvider
// tells them apart. Grid datasets belong to no data-type layer: they have
// their own gridded-coverage switch, and the data-type selection never hides
// them.
export function dataLayerKeyForDataset (row) {
  if (row.source_type === 'obis') return 'obis'
  if (TRAJECTORY_TYPES.has(row.cdm_data_type)) return 'trajectories'
  return PROFILE_TYPE_TO_KEY.get(row.cdm_data_type)
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
