// Which axes a record opens on, per dataset type — and the table-vs-plot default
// that falls out of them.
//
// This is deliberately a plain module, not part of DatasetPreviewPlot: the modal
// has to know whether a record can be plotted BEFORE it mounts the lazy ~1 MB
// Plotly chunk, and it cannot import the plot component to ask. Being free of
// React and Plotly also makes it the one piece of the preview that `node --test`
// can assert on (this frontend has no test runner).

// The unit ERDDAP published for a column, from the /preview payload's parallel
// columnNames / columnUnits arrays. Units never go in a share link — the column
// name is enough to look one back up.
export function unitFor (table, columnName) {
  if (!table || !columnName) return undefined
  const index = (table.columnNames || []).indexOf(columnName)
  return index === -1 ? undefined : (table.columnUnits || [])[index]
}

// Nothing selected. Also what the four dropdowns start from when a record has no
// default layout and the user opens the plot anyway.
export const EMPTY_PLOT_AXES = {
  x: { columnName: null, unit: null },
  y: { columnName: null, unit: null },
  secondary: null, // { columnName, unit } — optional 2nd variable
  color: null // { columnName, unit } — optional color-by variable
}

// The axes to open a record on, or null when this dataset type has no sensible
// default. `table` is consulted only for units, so the answer is stable from the
// first render — it does not change when the preview payload lands.
//
// Returning null rather than falling through is the point of the rewrite. The
// switch this replaces ended in `default: break`, which left whatever axes the
// PREVIOUS record had in place; now the caller shows the table instead.
export function defaultPlotAxesFor (dataset, table) {
  const variable = dataset && dataset.first_eov_column
  if (!variable) return null
  switch (dataset.cdm_data_type) {
  case 'Profile':
  case 'TimeSeriesProfile':
    // A cast: the measured variable across, depth down (the plot reverses y).
    return {
      x: { columnName: variable, unit: unitFor(table, variable) },
      y: { columnName: 'depth', unit: 'm' },
      secondary: null,
      color: null
    }
  case 'TimeSeries':
    return {
      x: { columnName: 'time', unit: 'UTC' },
      y: { columnName: variable, unit: unitFor(table, variable) },
      secondary: null,
      color: null
    }
  default:
    // Trajectory, TrajectoryProfile, Point, Grid, Other. Naming axes for these
    // is the faceting work; until then the table is a better answer than a
    // blank plot, so say so instead of guessing.
    return null
  }
}

// Table or plot when the link says nothing: plot wherever the axes can be named.
export function defaultVisFor (dataset) {
  return defaultPlotAxesFor(dataset) ? 'plot' : 'table'
}

// --- the plot's four roles, to and from the query string ---------------------
//
// Kept here rather than inside the hook so the encoding rule is assertable: it
// is the part with an invariant worth pinning down (a value equal to the default
// must leave no param, or a shared link grows a tail of settings nobody
// touched), and it needs neither React nor the router to state.

const AXIS_PARAMS = { x: 'px', y: 'py', secondary: 'p2', color: 'pcolor' }

const columnOf = (axis) => (axis && axis.columnName) || null

// `params` is anything with a .get(name) — a URLSearchParams in the app, a plain
// Map in a test. A role with no param falls back to the type default, so the URL
// only ever has to carry the roles the user actually changed.
export function axesFromParams (params, fallbackAxes, table) {
  const axes = {}
  Object.entries(AXIS_PARAMS).forEach(([role, param]) => {
    const columnName = params.get(param)
    axes[role] =
      columnName === null || columnName === undefined
        ? fallbackAxes[role]
        : { columnName, unit: unitFor(table, columnName) }
  })
  return axes
}

// The inverse: null for every role that matches its default (or is unset), which
// is the signal to delete that param.
export function axesToParams (nextAxes, fallbackAxes) {
  const changes = {}
  Object.entries(AXIS_PARAMS).forEach(([role, param]) => {
    const columnName = columnOf(nextAxes[role])
    changes[param] =
      !columnName || columnName === columnOf(fallbackAxes[role]) ? null : columnName
  })
  return changes
}
