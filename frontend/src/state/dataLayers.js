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

// What a first visit shows: everything. This filter works like the catalogue
// filters beside it — "nothing picked" means unfiltered, not empty — and the
// unfiltered answer for a geometry selector is every geometry. Opting one or
// two of them out of the default was the map quietly under-reporting what the
// catalogue holds before the user had asked for anything.
//
// All-on is therefore also the neutral state the UI presents as no selection
// (see isDataLayerChecked): a fully drawn map isn't a filter, so the pane shows
// no ticks, the badge shows the plain filter name, and no chip appears.
export const DEFAULT_DATA_LAYERS = ALL_DATA_LAYERS

// Is the map drawing every geometry — i.e. is this filter doing nothing? The
// same question as "is the selection empty" on the other filters.
export const allDataLayersOn = (dataLayers) =>
  !dataLayers || DATA_LAYER_KEYS.every((key) => dataLayers[key])

// What the checkbox shows. Everything-on is the unfiltered state, so it draws
// as no selection at all rather than as six ticks; once the user narrows, the
// ticks are the geometries they kept.
export const isDataLayerChecked = (dataLayers, key) =>
  !allDataLayersOn(dataLayers) && Boolean(dataLayers?.[key])

// The geometries a narrowed selection keeps, in render order. Empty when the
// filter is doing nothing.
export const selectedDataLayerKeys = (dataLayers) =>
  allDataLayersOn(dataLayers)
    ? []
    : DATA_LAYER_KEYS.filter((key) => dataLayers[key])

// Apply a selection, folding "nothing left" back to "everything" — unticking
// the last box lands on the unfiltered map, the way clearing any other filter
// does, instead of on a blank one that no control could recover from.
export const commitDataLayers = (next) =>
  DATA_LAYER_KEYS.some((key) => next[key]) ? next : { ...ALL_DATA_LAYERS }

// Narrow to a single geometry — what ticking a box means while everything is
// on, matching the other filters' first pick.
export const onlyDataLayer = (key) =>
  Object.fromEntries(DATA_LAYER_KEYS.map((k) => [k, k === key]))

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

// Is this the default selection? Only a non-default selection is worth writing
// to the URL (see useUrlSync), and an absent ?layers= restores the default.
// Everything-on IS the default now, so this is the same question as
// allDataLayersOn — kept as its own name because the callers mean different
// things by it (one asks "is this shareable state", the other "is this filter
// doing anything").
export const dataLayersAreDefault = allDataLayersOn
