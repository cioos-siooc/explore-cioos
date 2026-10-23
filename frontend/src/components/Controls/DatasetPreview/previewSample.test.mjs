import { test } from "node:test";
import assert from "node:assert/strict";

import { previewSampleFor } from "./previewSample.js";

const PROFILES = { column: "profile", count: 335 };
const ROWS = [
  { profile: "a", depth: 1 },
  { profile: "a", depth: 2 },
  { profile: "b", depth: 1 },
];

test("no note when the rows are the whole request, or nothing says", () => {
  assert.equal(
    previewSampleFor({
      sample: { rowCount: 3, totalRowCount: 3 },
      rows: ROWS,
      profiles: PROFILES,
      drawsOneProfile: false,
    }),
    null,
  );
  assert.equal(
    previewSampleFor({
      sample: undefined,
      rows: ROWS,
      profiles: PROFILES,
      drawsOneProfile: false,
    }),
    null,
  );
});

test("a window of a record of many profiles counts both", () => {
  assert.deepEqual(
    previewSampleFor({
      sample: { rowCount: 3, totalRowCount: 26131 },
      rows: ROWS,
      profiles: PROFILES,
      drawsOneProfile: false,
    }),
    {
      rowCount: 3,
      totalRowCount: 26131,
      profileCount: 2,
      totalProfileCount: 335,
    },
  );
});

test("one chosen profile, or a record with none listed, counts rows only", () => {
  const rowsOnly = {
    rowCount: 3,
    totalRowCount: 1500,
    profileCount: null,
    totalProfileCount: null,
  };
  assert.deepEqual(
    previewSampleFor({
      sample: { rowCount: 3, totalRowCount: 1500 },
      rows: ROWS,
      profiles: PROFILES,
      drawsOneProfile: true,
    }),
    rowsOnly,
  );
  assert.deepEqual(
    previewSampleFor({
      sample: { rowCount: 3, totalRowCount: 1500 },
      rows: ROWS,
      profiles: { column: null, count: 0 },
      drawsOneProfile: false,
    }),
    rowsOnly,
  );
});
