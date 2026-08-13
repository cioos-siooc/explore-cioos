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
// The order follows the taxonomy: the single sample, then the three that
// sample a fixed place, then the two that sample along a path, then the
// occurrence records. The two trajectory rows are kept adjacent because the
// track/hex display options render once, under the pair.
//
// 'trajectories' (plural) is the plain-Trajectory key. It keeps its old name
// so the ?layers= links already in the wild still resolve. Adding 'point' is
// safe for the same links: ?layers= is a comma list of these NAMES, so a new
// key changes render order only, never the meaning of an existing link.
export const DATA_LAYER_LABEL_KEYS = {
  point: 'layerPoint',
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
  point: 'layerPointHint',
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
// as no selection at all rather than as a full set of ticks; once the user narrows, the
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

// Whether the trajectory layers draw their track lines, which is the one
// trajectory-specific display choice left (their cells are hexes like every
// other geometry's, under the same hex/point switch). On by default: the lines
// are the more legible first view of a voyage.
export const DEFAULT_TRACKS_MODE = true

// The cdm_data_types that share cde.profiles. The tile query names them
// directly (profileTypes=<comma list>), so this doubles as the wire mapping.
//
// Point is here because a small Point dataset is stored as exact rows in
// cde.profiles — but it is the one type that is not tied to a single table:
// above a size cutoff the harvester stores it as coverage cells instead, so
// it appears in POINT_TYPE_KEYS below as well. A given dataset's rows only
// ever live in one table, so naming Point on both wire params returns the
// right union without the client tracking which table it landed in.
export const PROFILE_TYPE_KEYS = [
  ['point', 'Point'],
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

// Point again, for the cell side of the same switch. Kept as its own list so
// the trajectory pair keeps meaning exactly the trajectory pair — it also
// drives the track-lines layer, which Point has nothing to contribute to.
export const POINT_TYPE_KEYS = [['point', 'Point']]

const TYPE_TO_KEY = new Map(
  [...PROFILE_TYPE_KEYS, ...TRAJECTORY_TYPE_KEYS].map(([key, type]) => [
    type,
    key
  ])
)

// Which switch governs a dataset, or undefined when none does. OBIS datasets
// carry cdm_data_type 'Point', and so now do the ERDDAP datasets on the Point
// layer — the collision this source-first check was written against is a live
// case rather than a hypothetical one, so the order here is load-bearing.
// SelectionProvider tells them apart the same way. Grid datasets belong to no
// geometry layer: they have their own gridded-coverage switch, and the
// geometry selection never hides them.
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
