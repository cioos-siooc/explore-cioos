// columnMeta (harvested per-variable metadata) is absent for a dataset not yet
// reharvested, so every field falls back to ERDDAP's parallel column arrays.
//
// Pure on purpose: the modal must classify columns BEFORE mounting the lazy
// ~1 MB Plotly chunk, and this is the layer `node --test` can assert on.

// ERDDAP's numeric data types. `String` and `char` cannot carry an axis.
const NUMERIC_TYPES = new Set([
  "double",
  "float",
  "long",
  "int",
  "short",
  "byte",
  "ulong",
  "uint",
  "ushort",
  "ubyte",
]);

// 'UTC' is how ERDDAP marks a time column in columnUnits.
const TIME_UNITS = new Set(["UTC"]);
// ERDDAP may state a time column's units as its format string
// (mpoEaeTemperature `year`: "CCYY-MM-DD").
const TIME_FORMAT_UNIT = /^[Cy]{2,4}[-/]?(MM|mm|M)?/;
const LAT_UNITS = new Set(["degrees_north", "Degrees north"]);
const LON_UNITS = new Set(["degrees_east", "Degrees east"]);

const COORDINATE_STANDARD_NAMES = new Set([
  "time",
  "latitude",
  "longitude",
  "depth",
  "altitude",
]);
const COORDINATE_NAMES = new Set([
  "time",
  "latitude",
  "longitude",
  "lat",
  "lon",
  "depth",
  "altitude",
]);
const COORDINATE_AXES = new Set(["T", "X", "Y", "Z"]);

// Fallback for datasets harvested without ancillary_variables metadata.
const FLAG_NAME = /_(qc|qa|flag|flags)$/i;

// `_id` in any case, or a trailing camelCase `ID` (mpoEaeTemperature's
// `minilogID`). Deliberately narrow: must not catch names merely ending in i-d.
const ID_NAME = /(_id|[a-z0-9]ID)$/;

// ioos_category is authoritative where it is declared (~48% of variables).
const ID_CATEGORIES = new Set(["Identifier"]);
// "Location" is deliberately NOT here: it says what a column is ABOUT, not that
// it is an axis. Every column in the catalogue that really is a horizontal
// coordinate also declares axis, a CF standard_name, or degrees units, so the
// category added nothing there — while it classified ismerOsl002's `distance`
// (the along-transect abscissa, units m, no axis, no standard_name) as a
// coordinate, which left that record with no measurement to draw at all.
const COORDINATE_CATEGORIES = new Set(["Time"]);

const trimmed = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// columnName -> role from the dataset's three *_id_variable fields: the only
// cf_role source for a dataset harvested before columnMeta existed.
function recordIdRoles(dataset) {
  const roles = new Map();
  [
    ["timeseries_id", dataset && dataset.timeseries_id_variable],
    ["profile_id", dataset && dataset.profile_id_variable],
    ["trajectory_id", dataset && dataset.trajectory_id_variable],
  ].forEach(([role, columnName]) => {
    if (columnName) roles.set(columnName, role);
  });
  return roles;
}

// ERDDAP separates ancillary_variables with spaces or commas.
function flaggedColumns(columnMeta) {
  const flags = new Set();
  (columnMeta || []).forEach((meta) => {
    const ancillary = meta && trimmed(meta.ancillary_variables);
    if (!ancillary) return;
    ancillary
      .split(/[\s,]+/)
      .filter(Boolean)
      .forEach((name) => flags.add(name));
  });
  return flags;
}

function classify(variable, { flagColumns }) {
  if (isTimeLike(variable)) return "coordinate"; // rqmMoh*Ctd publish cf_role=profile_id ON time
  if (
    variable.cfRole ||
    ID_CATEGORIES.has(variable.ioosCategory) ||
    ID_NAME.test(variable.columnName)
  ) {
    return "id";
  }
  if (
    flagColumns.has(variable.columnName) ||
    FLAG_NAME.test(variable.columnName)
  ) {
    return "flag";
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
    return "coordinate";
  }
  return variable.isNumeric ? "measurement" : "other";
}

// `dataset` supplies only the cf_role column names; omit it and id detection
// falls back to columnMeta's cfRole.
export function variablesFrom(table, dataset) {
  if (!table || !table.columnNames) return [];
  const { columnNames, columnTypes = [], columnUnits = [], columnMeta } = table;
  const idRoles = recordIdRoles(dataset);
  const flagColumns = flaggedColumns(columnMeta);

  const variables = columnNames.map((columnName, index) => {
    const meta = (columnMeta && columnMeta[index]) || null;
    const type = trimmed(columnTypes[index]) || (meta && trimmed(meta.type));
    return {
      columnName,
      // ERDDAP's answer for THIS query wins over a harvest that may predate a
      // units change.
      unit:
        trimmed(columnUnits[index]) || (meta && trimmed(meta.units)) || null,
      type,
      isNumeric: NUMERIC_TYPES.has(String(type)),
      longName: meta && trimmed(meta.long_name),
      standardName: meta && trimmed(meta.standard_name),
      // columnMeta is what ERDDAP publishes; the dataset id fields are inferred.
      cfRole:
        (meta && trimmed(meta.cf_role)) || idRoles.get(columnName) || null,
      axis: meta && trimmed(meta.axis),
      positive: meta && trimmed(meta.positive),
      ioosCategory: meta && trimmed(meta.ioos_category),
      palette: meta && trimmed(meta.colorBarPalette),
      // Read by previewColorScales.js for the colour dimension's ramp.
      colorBarScale: meta && trimmed(meta.colorBarScale),
      // Deliberately unread, now that the colour dimension could read them:
      // ERDDAP's colorBar bounds are per standard_name across a whole catalogue
      // (0-8000 for depth, 0-32 for temperature), and one record spans a sliver
      // of that — honouring them would flatten every profile to two adjacent
      // shades of its ramp. Kept because they describe the column, and the next
      // reader should see the decision rather than assume an oversight.
      cmin: meta ? numberOr(meta.colorBarMinimum, undefined) : undefined,
      cmax: meta ? numberOr(meta.colorBarMaximum, undefined) : undefined,
    };
  });

  return variables.map((variable) => ({
    ...variable,
    kind: classify(variable, { flagColumns }),
  }));
}

export function labelFor(variable) {
  if (!variable) return "";
  const name = shortLabelFor(variable);
  return variable.unit ? `${name} ( ${variable.unit} )` : name;
}

export function shortLabelFor(variable) {
  if (!variable) return "";
  return variable.longName || variable.columnName;
}

export function byColumnName(variables) {
  const index = new Map();
  (variables || []).forEach((variable) =>
    index.set(variable.columnName, variable),
  );
  return index;
}

export function measurementsOf(variables) {
  return (variables || []).filter(
    (variable) => variable.kind === "measurement",
  );
}

// A TimeSeriesProfile declares two: the station clicked and the profile drawn.
export function idVariablesFor(variables) {
  return (variables || []).filter((variable) => variable.cfRole);
}

// Separate from `kind === 'coordinate'` because time arrives as ISO text, so
// the colour dimension has to know to parse it before ordering it.
export function isTimeLike(variable) {
  if (!variable) return false;
  return Boolean(
    variable.axis === "T" ||
    variable.standardName === "time" ||
    TIME_UNITS.has(variable.unit) ||
    (variable.unit && TIME_FORMAT_UNIT.test(variable.unit)),
  );
}

// `positive` is the only attribute that says so; failing it, CF's convention
// that depth increases downward and altitude upward.
export function isDownwardVertical(variable) {
  if (!variable) return false;
  if (variable.positive) return variable.positive.toLowerCase() === "down";
  const name = (
    variable.standardName ||
    variable.columnName ||
    ""
  ).toLowerCase();
  return (
    name === "depth" ||
    name === "pressure" ||
    name === "sea_water_pressure" ||
    name.startsWith("depth")
  );
}
