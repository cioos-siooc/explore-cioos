import { test } from "node:test";
import assert from "node:assert/strict";

import { formatCell, tableLayoutFor } from "./previewTable.js";

test("a reading keeps seven significant digits, never cutting a whole number", () => {
  assert.equal(formatCell(1.9791645060818657), "1.979165");
  assert.equal(formatCell(0.000123456789), "0.0001234568");
  assert.equal(formatCell(-1.538), "-1.538");
  assert.equal(formatCell(12345680.4), "12345680");
  assert.equal(formatCell(2.5), "2.5");
  assert.equal(formatCell(2007006), "2007006");
});

test("text and gaps print as they are", () => {
  assert.equal(formatCell("2007-10-04T12:52:08Z"), "2007-10-04T12:52:08Z");
  assert.equal(formatCell(null), "");
  assert.equal(formatCell(undefined), "");
});

const TABLE = {
  columnNames: ["platform", "PSAL", "depth", "time"],
  columnUnits: [null, "PSU", "m", "UTC"],
};
const ROWS = [
  { platform: "Amundsen", PSAL: 29.817, depth: 2, time: "2007-10-04" },
  { platform: "Amundsen", PSAL: 29.816, depth: 3, time: "2007-10-04" },
];
const VARIABLES = [
  { columnName: "depth", kind: "coordinate" },
  { columnName: "time", kind: "coordinate" },
  { columnName: "PSAL", kind: "measurement" },
];

test("columns the same on every row are said once, not repeated down the grid", () => {
  const { constants, columns } = tableLayoutFor(TABLE, ROWS, VARIABLES);
  assert.deepEqual(constants, [
    { name: "platform", unit: null, value: "Amundsen" },
    { name: "time", unit: "UTC", value: "2007-10-04" },
  ]);
  assert.deepEqual(
    columns.map(({ name }) => name),
    ["depth", "PSAL"],
  );
});

test("the coordinates lead the varying columns", () => {
  const rows = ROWS.map((row, index) => ({ ...row, time: `t${index}` }));
  const { columns } = tableLayoutFor(TABLE, rows, VARIABLES);
  assert.deepEqual(
    columns.map(({ name }) => name),
    ["depth", "time", "PSAL"],
  );
});

test("a single row keeps every column in the grid", () => {
  const { constants, columns } = tableLayoutFor(TABLE, ROWS.slice(0, 1));
  assert.deepEqual(constants, []);
  assert.equal(columns.length, 4);
});

test("a column is sized to its longest text, within bounds", () => {
  const rows = [
    { platform: "x".repeat(200), PSAL: 1.5, depth: 1, time: "a" },
    { platform: "y", PSAL: 2.5, depth: 2, time: "b" },
  ];
  const widths = Object.fromEntries(
    tableLayoutFor(TABLE, rows).columns.map(({ name, width }) => [name, width]),
  );
  assert.equal(widths.platform, 280);
  assert.ok(widths.depth >= 72 && widths.depth < 100, `${widths.depth}px`);
});
