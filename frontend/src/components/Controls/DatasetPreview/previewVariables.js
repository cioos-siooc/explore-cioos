// One description of one column of a /preview payload, from whichever source is
// available.
//
// The preview response always carries ERDDAP's parallel columnNames /
// columnTypes / columnUnits arrays. Since datasets.table_variables landed it may
// also carry columnMeta — the harvested per-variable metadata, positionally
// aligned, null for a column the harvest does not know. That key is absent
// entirely for a dataset not yet reharvested, which is why every field below has
// a fallback: the plot has to work either way, and gets better labels once a
// harvest with `incremental: false` has run.
//
// Pure on purpose: the modal must classify columns BEFORE mounting the lazy
// ~1 MB Plotly chunk, and this is the layer `node --test` can assert on.

// ERDDAP's numeric data types. `String` and `char` cannot carry an axis.
const NUMERIC_TYPES = new Set([
  'double', 'float', 'long', 'int', 'short', 'byte',
  'ulong', 'uint', 'ushort', 'ubyte'
])

// Units that identify a coordinate no matter what the column is called. 'UTC' is
// how ERDDAP marks a time column in columnUnits — more reliable than matching
// the name 'time', which is what this replaces.
const TIME_UNITS = new Set(['UTC'])
// ERDDAP also states a time column's units as its format string. mpoEaeTemperature
// publishes `year` with units "CCYY-MM-DD"; without this it reads as a plottable
// number and clutters the variable picker.
const TIME_FORMAT_UNIT = /^[Cy]{2,4}[-/]?(MM|mm|M)?/
const LAT_UNITS = new Set(['degrees_north', 'Degrees north'])
const LON_UNITS = new Set(['degrees_east', 'Degrees east'])

const COORDINATE_STANDARD_NAMES = new Set([
  'time', 'latitude', 'longitude', 'depth', 'altitude'
])
const COORDINATE_NAMES = new Set([
  'time', 'latitude', 'longitude', 'lat', 'lon', 'depth', 'altitude'
])
const COORDINATE_AXES = new Set(['T', 'X', 'Y', 'Z'])

// A QC column when nothing declares it as one. The authoritative signal is
// another variable's ancillary_variables; this is the fallback for datasets
// harvested without metadata.
const FLAG_NAME = /_(qc|qa|flag|flags)$/i

// An identifier column that declares no cf_role. `_id` in any case, or a
// trailing camelCase `ID` (mpoEaeTemperature's `minilogID`, an instrument serial
// whose ioos_category is only "Other"). Deliberately narrow: it must not catch a
// variable that merely ends in the letters i-d.
const ID_NAME = /(_id|[a-z0-9]ID)$/

// ioos_category is authoritative where it is declared (~48% of variables).
const ID_CATEGORIES = new Set(['Identifier'])
const COORDINATE_CATEGORIES = new Set(['Time', 'Location'])

const trimmed = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const numberOr = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// Which of the dataset's columns are the CF-role id columns. shapeQuery.js has
// been sending these three fields all along and nothing read them until now.
function recordIdColumns (dataset) {
  return new Set(
    [
      dataset && dataset.timeseries_id_variable,
      dataset && dataset.profile_id_variable,
      dataset && dataset.trajectory_id_variable
    ].filter(Boolean)
  )
}

// Every column named by some other variable's ancillary_variables. ERDDAP
// publishes it space- or comma-separated.
function flaggedColumns (columnMeta) {
  const flags = new Set()
  ;(columnMeta || []).forEach((meta) => {
    const ancillary = meta && trimmed(meta.ancillary_variables)
    if (!ancillary) return
    ancillary.split(/[\s,]+/).filter(Boolean).forEach((name) => flags.add(name))
  })
  return flags
}

function classify (variable, { idColumns, flagColumns }) {
  if (
    idColumns.has(variable.columnName) ||
    variable.cfRole ||
    ID_CATEGORIES.has(variable.ioosCategory) ||
    ID_NAME.test(variable.columnName)
  ) {
    return 'id'
  }
  if (flagColumns.has(variable.columnName) || FLAG_NAME.test(variable.columnName)) {
    return 'flag'
  }
  if (
    COORDINATE_AXES.has(variable.axis) ||
    COORDINATE_STANDARD_NAMES.has(variable.standardName) ||
    COORDINATE_CATEGORIES.has(variable.ioosCategory) ||
    TIME_UNITS.has(variable.unit) ||
    LAT_UNITS.has(variable.unit) ||
    LON_UNITS.has(variable.unit) ||
    (variable.unit && TIME_FORMAT_UNIT.test(variable.unit)) ||
    COORDINATE_NAMES.has(variable.columnName.toLowerCase())
  ) {
    return 'coordinate'
  }
  return variable.isNumeric ? 'measurement' : 'other'
}

// The whole column set, in ERDDAP's order. `dataset` supplies only the cf_role
// column names; pass nothing and id detection falls back to columnMeta's cfRole.
export function variablesFrom (table, dataset) {
  if (!table || !table.columnNames) return []
  const { columnNames, columnTypes = [], columnUnits = [], columnMeta } = table
  const idColumns = recordIdColumns(dataset)
  const flagColumns = flaggedColumns(columnMeta)

  const variables = columnNames.map((columnName, index) => {
    const meta = (columnMeta && columnMeta[index]) || null
    const type = trimmed(columnTypes[index]) || (meta && trimmed(meta.type))
    const variable = {
      columnName,
      // columnUnits is ERDDAP's own answer for THIS query, so it wins over the
      // harvest, which may predate a units change.
      unit: trimmed(columnUnits[index]) || (meta && trimmed(meta.units)) || null,
      type,
      isNumeric: NUMERIC_TYPES.has(String(type)),
      longName: meta && trimmed(meta.long_name),
      standardName: meta && trimmed(meta.standard_name),
      cfRole: meta && trimmed(meta.cf_role),
      axis: meta && trimmed(meta.axis),
      positive: meta && trimmed(meta.positive),
      ioosCategory: meta && trimmed(meta.ioos_category),
      palette: meta && trimmed(meta.colorBarPalette),
      colorBarScale: meta && trimmed(meta.colorBarScale),
      cmin: meta ? numberOr(meta.colorBarMinimum, undefined) : undefined,
      cmax: meta ? numberOr(meta.colorBarMaximum, undefined) : undefined
    }
    return variable
  })

  return variables.map((variable) => ({
    ...variable,
    kind: classify(variable, { idColumns, flagColumns })
  }))
}

// "Temperature (1990 scale) ( degree_C )" once a harvest has run, "TE90_01
// ( degree_C )" before it. standard_name sits between the two because it is at
// least words, where a column name is often a BODC P01 code.
export function labelFor (variable) {
  if (!variable) return ''
  const name = variable.longName || variable.standardName || variable.columnName
  return variable.unit ? `${name} ( ${variable.unit} )` : name
}

// Same precedence without the unit — for a dropdown, where the unit is noise.
export function shortLabelFor (variable) {
  if (!variable) return ''
  return variable.longName || variable.columnName
}

export function byColumnName (variables) {
  const index = new Map()
  ;(variables || []).forEach((variable) => index.set(variable.columnName, variable))
  return index
}

// What can go in a panel: numeric, and not an axis, an id or a QC flag.
export function measurementsOf (variables) {
  return (variables || []).filter((variable) => variable.kind === 'measurement')
}

// A depth axis has to be drawn downwards. `positive` is the only attribute that
// says so; without it, the CF convention that `depth` increases downward and
// `altitude` upward is the next best thing.
export function isDownwardVertical (variable) {
  if (!variable) return false
  if (variable.positive) return variable.positive.toLowerCase() === 'down'
  const name = (variable.standardName || variable.columnName || '').toLowerCase()
  return name === 'depth' || name === 'pressure' || name.startsWith('depth')
}
