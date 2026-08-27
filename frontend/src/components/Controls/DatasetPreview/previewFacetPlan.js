// What to draw for a record: which axis every panel shares, which way the panels
// stack, and which variables get a panel by default.
//
// The layouts come from CDE_Graphs_SANDBOX.png, one per cdm_data_type:
//
//   PROFILS / TIMESERIES PROFILS / TRAJECTORIES PROFILS
//     panels side by side, each with its own X on top, all sharing one depth
//     axis on the left that runs downwards.
//   TIMESERIES / TRAJECTORIES
//     panels stacked, each with its own Y, all sharing one X at the bottom
//     (time, or longitude/latitude for a trajectory), first variable at the
//     bottom.
//   POINT
//     stacked like a timeseries, but the shared X is the FIRST VARIABLE rather
//     than a coordinate.
//
// Point needs no branch of its own: the shared axis is always excluded from the
// panel set, so "variable 1 on x, the rest as panels" is what falls out of
// pointing the shared axis at a measurement.
//
// Pure: no React, no Plotly. DatasetPreview asks whether a plot is possible at
// all before mounting the lazy chunk, and this is what answers.

import {
  isDownwardVertical,
  measurementsOf
} from './previewVariables.js'

export const COLUMNS = 'columns' // profiles: panels across, shared Y
export const ROWS = 'rows' // timeseries: panels stacked, shared X

const PROFILE_TYPES = new Set([
  'Profile',
  'TimeSeriesProfile',
  'TrajectoryProfile'
])

const find = (variables, predicate) => variables.find(predicate)

const verticalCoordinate = (variables) =>
  find(
    variables,
    (variable) =>
      variable.kind === 'coordinate' &&
      (variable.axis === 'Z' ||
        variable.standardName === 'depth' ||
        variable.standardName === 'altitude' ||
        variable.columnName.toLowerCase() === 'depth')
  )

const timeCoordinate = (variables) =>
  find(
    variables,
    (variable) =>
      variable.kind === 'coordinate' &&
      (variable.axis === 'T' ||
        variable.standardName === 'time' ||
        variable.unit === 'UTC')
  )

// Whichever of latitude / longitude actually moves over the record. The image
// writes this as max([lat],[lon]): a north-south track is best read against
// latitude, an east-west one against longitude, and picking the wrong one
// collapses the plot onto a single value.
function trackCoordinate (variables, data) {
  const candidates = ['longitude', 'latitude']
    .map((standardName) =>
      find(
        variables,
        (variable) =>
          variable.kind === 'coordinate' && variable.standardName === standardName
      )
    )
    .filter(Boolean)
  if (candidates.length < 2 || !data || !data.length) return candidates[0]

  const spanOf = (variable) => {
    let min = Infinity
    let max = -Infinity
    data.forEach((row) => {
      const value = Number(row[variable.columnName])
      if (!Number.isFinite(value)) return
      if (value < min) min = value
      if (value > max) max = value
    })
    return max > min ? max - min : 0
  }
  return spanOf(candidates[1]) > spanOf(candidates[0])
    ? candidates[1]
    : candidates[0]
}

// Columns offerable as the shared axis, most plausible first. Coordinates lead
// because they are what the layouts assume; every measurement follows so
// "salinity against temperature" stays reachable, which is the whole point of
// keeping the axis overridable.
export function sharedCandidatesFor (variables) {
  const coordinates = (variables || []).filter(
    (variable) => variable.kind === 'coordinate'
  )
  return [...coordinates, ...measurementsOf(variables)]
}

// The shared axis a dataset type implies, or undefined when nothing fits.
function defaultSharedFor (dataset, variables, data) {
  const type = (dataset && dataset.cdm_data_type) || ''
  if (PROFILE_TYPES.has(type)) return verticalCoordinate(variables)
  if (type === 'TimeSeries') return timeCoordinate(variables)
  if (type === 'Trajectory') {
    return trackCoordinate(variables, data) || timeCoordinate(variables)
  }
  if (type === 'Point') return measurementsOf(variables)[0]
  return undefined
}

// The panels a record opens on: the dataset's own first EOV column when it is
// plottable, else the first measurement. One panel, matching what the preview
// showed before faceting.
function defaultPanelsFor (dataset, variables, shared) {
  const measurements = measurementsOf(variables).filter(
    (variable) => !shared || variable.columnName !== shared.columnName
  )
  if (!measurements.length) return []
  const preferred =
    dataset &&
    dataset.first_eov_column &&
    measurements.find(
      (variable) => variable.columnName === dataset.first_eov_column
    )
  return [(preferred || measurements[0]).columnName]
}

// null when this record cannot be plotted — the caller shows the table, which is
// what Grid and any unrecognised cdm_data_type get.
export function facetPlanFor (dataset, variables, data) {
  if (!dataset || !variables || !variables.length) return null
  const type = dataset.cdm_data_type || ''
  const orientation = PROFILE_TYPES.has(type) ? COLUMNS : ROWS

  const shared = defaultSharedFor(dataset, variables, data)
  if (!shared) return null

  const panelDefaults = defaultPanelsFor(dataset, variables, shared)
  if (!panelDefaults.length) return null

  return {
    orientation,
    sharedAxis: shared.columnName,
    // A depth axis runs downwards; nothing else is reversed.
    sharedReversed: orientation === COLUMNS && isDownwardVertical(shared),
    sharedCandidates: sharedCandidatesFor(variables).map(
      (variable) => variable.columnName
    ),
    panelDefaults
  }
}

// Resolve a plan against the user's choices. The shared axis is never also a
// panel, and a column named in a link that this dataset does not have is
// dropped rather than drawn empty.
export function resolvePanels (panels, variables, sharedAxis) {
  const available = new Set(
    (variables || []).map((variable) => variable.columnName)
  )
  const seen = new Set()
  return (panels || []).filter((columnName) => {
    if (columnName === sharedAxis) return false
    if (!available.has(columnName)) return false
    if (seen.has(columnName)) return false
    seen.add(columnName)
    return true
  })
}

// Table or plot when the link says nothing.
//
// Deliberately decided from cdm_data_type ALONE, never from the payload: the
// /preview fetch is async, so a default that consulted the columns would answer
// "table" on the first render and "plot" once the rows landed, bouncing the user
// between views mid-load. The type is what says whether a layout exists at all;
// a plottable type with no plottable column is rare and better reported by the
// plot than by silently reverting to the table.
const PLOTTABLE_TYPES = new Set([
  ...PROFILE_TYPES,
  'TimeSeries',
  'Trajectory',
  'Point'
])

export function defaultVisFor (dataset) {
  return PLOTTABLE_TYPES.has((dataset && dataset.cdm_data_type) || '')
    ? 'plot'
    : 'table'
}
