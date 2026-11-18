// How the Table view lays out a record. Pure, so it is assertable under
// `node --test`.

// Enough to tell neighbouring readings apart; a CTD's 1.9791645060818657 m
// reads as 1.979165. The full value stays in the cell's title.
const SIGNIFICANT_DIGITS = 7;
// An estimate of the cell text's advance, generous so a cell is never cut —
// sized for the phone rung, where the table's type steps up.
const CHAR_PX = 9;
const CELL_PADDING_PX = 32;
const MIN_COLUMN_PX = 72;
const MAX_COLUMN_PX = 280;

export function formatCell(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value == null ? "" : String(value);
  }
  if (Number.isInteger(value)) return String(value);
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.min(
    Math.max(SIGNIFICANT_DIGITS - magnitude - 1, 0),
    20,
  );
  const fixed = value.toFixed(decimals);
  return decimals ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

// A loop, not Math.max(...): a preview holds up to 5000 rows.
const widthFor = (texts) => {
  const longest = texts.reduce((most, text) => Math.max(most, text.length), 0);
  return Math.min(
    Math.max(longest * CHAR_PX + CELL_PADDING_PX, MIN_COLUMN_PX),
    MAX_COLUMN_PX,
  );
};

/**
 * Splits the columns into the ones that are the same on every row — a cast's
 * platform, cruise, station and position — and the ones that vary, which are
 * what the table is for. The varying ones lead with the record's coordinates
 * (time, depth) so a reading is always beside where and when it was taken.
 *
 * @param table      /preview's { columnNames, columnUnits }
 * @param rows       the rows as objects keyed by column name
 * @param variables  the preview's classified columns, if known
 * @returns { constants: [{ name, unit, value }], columns: [{ name, unit, width }] }
 */
export function tableLayoutFor(
  { columnNames, columnUnits = [] },
  rows,
  variables,
) {
  const units = new Map(
    columnNames.map((name, index) => [name, columnUnits[index] || null]),
  );
  const isCoordinate = new Set(
    (variables || [])
      .filter((variable) => variable.kind === "coordinate")
      .map((variable) => variable.columnName),
  );
  const isConstant = (name) =>
    rows.length > 1 && rows.every((row) => row[name] === rows[0][name]);

  const constants = columnNames.filter(isConstant).map((name) => ({
    name,
    unit: units.get(name),
    value: formatCell(rows[0][name]),
  }));
  const varying = columnNames.filter((name) => !isConstant(name));
  const ordered = [
    ...varying.filter((name) => isCoordinate.has(name)),
    ...varying.filter((name) => !isCoordinate.has(name)),
  ];
  const columns = ordered.map((name) => {
    const unit = units.get(name);
    return {
      name,
      unit,
      width: widthFor([
        name,
        unit ? `(${unit})` : "",
        ...rows.map((row) => formatCell(row[name])),
      ]),
    };
  });
  return { constants, columns };
}
