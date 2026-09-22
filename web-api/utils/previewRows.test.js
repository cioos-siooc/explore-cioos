const test = require("node:test");
const assert = require("node:assert/strict");

const { trimPreviewRows } = require("./previewRows");

const table = (times, extra = []) => ({
  columnNames: ["time", "temperature"],
  rows: times.map((t, i) => [t, i]).concat(extra),
});

test("leaves a table already within the limit untouched", () => {
  const t = table(["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"]);
  const rows = t.rows;
  assert.equal(trimPreviewRows(t, 10).rows, rows);
});

test("keeps the newest rows when ERDDAP returns more than the limit", () => {
  const t = table([
    "2024-01-01T00:00:00Z",
    "2024-01-02T00:00:00Z",
    "2024-01-03T00:00:00Z",
  ]);
  assert.deepEqual(
    trimPreviewRows(t, 2).rows.map((r) => r[0]),
    ["2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z"],
  );
});

test("keeps the newest rows even when ERDDAP returns them out of order", () => {
  // tabledap does not promise row order, so the tail of the response is not
  // necessarily the newest data. This is the case a bare slice(-n) gets wrong.
  const t = table([
    "2024-01-03T00:00:00Z",
    "2024-01-01T00:00:00Z",
    "2024-01-05T00:00:00Z",
    "2024-01-02T00:00:00Z",
  ]);
  assert.deepEqual(
    trimPreviewRows(t, 2).rows.map((r) => r[0]),
    ["2024-01-03T00:00:00Z", "2024-01-05T00:00:00Z"],
  );
});

test("falls back to the head slice when there is no time column", () => {
  const t = {
    columnNames: ["depth", "salinity"],
    rows: [
      [1, 2],
      [3, 4],
    ],
  };
  assert.deepEqual(trimPreviewRows(t, 1).rows, [[1, 2]]);
});

test("keeps the shallow end of a record sampled at a single instant", () => {
  // One cast: every row shares a timestamp and row order is the depth
  // sequence, so the tail would return only the deepest bins.
  const t = {
    columnNames: ["time", "depth"],
    rows: [0, 10, 20, 30].map((d) => ["2024-01-01T00:00:00Z", d]),
  };
  assert.deepEqual(
    trimPreviewRows(t, 2).rows.map((r) => r[1]),
    [0, 10],
  );
});

test("preserves ERDDAP's order among rows sharing a timestamp", () => {
  // Stability matters: the plot draws lines in row order.
  const t = {
    columnNames: ["time", "depth"],
    rows: [
      ["2024-01-01T00:00:00Z", 0],
      ["2024-01-02T00:00:00Z", 0],
      ["2024-01-02T00:00:00Z", 5],
      ["2024-01-02T00:00:00Z", 10],
    ],
  };
  assert.deepEqual(
    trimPreviewRows(t, 3).rows.map((r) => r[1]),
    [0, 5, 10],
  );
});

test("drops rows with unparseable times before real ones", () => {
  const t = {
    columnNames: ["time", "depth"],
    rows: [
      ["", 1],
      ["2024-01-01T00:00:00Z", 2],
      ["2024-01-02T00:00:00Z", 3],
    ],
  };
  assert.deepEqual(
    trimPreviewRows(t, 2).rows.map((r) => r[1]),
    [2, 3],
  );
});
