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

export const allDataLayersOn = (dataLayers) =>
  !dataLayers || Object.values(dataLayers).every(Boolean)
