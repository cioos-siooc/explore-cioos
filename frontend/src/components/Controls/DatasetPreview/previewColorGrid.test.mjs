import { test } from "node:test";
import assert from "node:assert/strict";

import { colorGridFor } from "./previewColorGrid.js";

const grid = (rows, limits = {}) =>
  colorGridFor({
    xValues: rows.map(([x]) => x),
    yValues: rows.map(([, y]) => y),
    zValues: rows.map(([, , z]) => z),
    maxColumns: 100,
    maxRows: 100,
    ...limits,
  });

test("every distinct value is its own cell while they fit", () => {
  const { x, y, z } = grid([
    [0, 1, 10],
    [0, 2, 20],
    [5, 1, 30],
    [5, 2, 40],
  ]);
  assert.deepEqual(x, [0, 5]);
  assert.deepEqual(y, [1, 2]);
  assert.deepEqual(z, [
    [10, 30],
    [20, 40],
  ]);
});

test("past its limit an axis is cut into equal bins, each holding the mean", () => {
  const { y, z } = grid(
    [
      [0, 0, 1],
      [0, 1, 3],
      [0, 3, 10],
      [1, 0, 5],
    ],
    { maxRows: 2 },
  );
  assert.deepEqual(y, [0.75, 2.25]); // bin centres over 0..3
  assert.deepEqual(z, [
    [2, 5],
    [10, null],
  ]);
});

test("a column's gaps are filled along Y, but never past its own samples", () => {
  const { z } = grid([
    [0, 0, 0],
    [0, 3, 30],
    [1, 0, 0],
    [1, 1, 1],
    [1, 2, 2],
    [1, 3, 3],
    [1, 4, 4],
  ]);
  assert.deepEqual(
    z.map((row) => row[0]),
    [0, 10, 20, 30, null],
  );
});

test("a time axis is gridded by instant and read back as ISO", () => {
  const timed = colorGridFor({
    xValues: ["2025-09-17T00:00:00Z", "2025-09-16T00:00:00Z"],
    yValues: [1, 2],
    zValues: [1, 2],
    xIsTime: true,
    maxColumns: 100,
    maxRows: 100,
  });
  assert.deepEqual(timed.x, [
    "2025-09-16T00:00:00.000Z",
    "2025-09-17T00:00:00.000Z",
  ]);
});

test("rows missing X, Y or a colour are left out", () => {
  const { x, z } = grid([
    [0, 1, 10],
    [null, 1, 99],
    [1, "", 99],
    [1, 1, null],
    [2, 1, 30],
    [2, 2, 40],
  ]);
  assert.deepEqual(x, [0, 2]);
  assert.deepEqual(z[0], [10, 30]);
});

test("one cast, or one depth, has nothing to spread over", () => {
  assert.equal(
    grid([
      [0, 1, 10],
      [0, 2, 20],
    ]),
    null,
  );
  assert.equal(
    grid([
      [0, 1, 10],
      [1, 1, 20],
    ]),
    null,
  );
});
