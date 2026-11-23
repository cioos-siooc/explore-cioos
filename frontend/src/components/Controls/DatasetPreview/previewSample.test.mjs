import { test } from "node:test";
import assert from "node:assert/strict";

import {
  earliestTime,
  previewSampleFor,
  previewWindowFor,
} from "./previewSample.js";

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

test("the page before ends at the earliest readable time, in any row order", () => {
  assert.equal(
    earliestTime([
      { time: "2024-03-02T00:00:00Z" },
      { time: "not a time" },
      { time: "2024-03-01T12:30:00Z" },
    ]),
    "2024-03-01T12:30:00.000Z",
  );
  assert.equal(earliestTime([{ depth: 1 }]), null);
});

test("window controls only for a window of the record, and no paging in a period", () => {
  const rows = [{ time: "2024-03-01T00:00:00Z" }];
  const partial = { rowCount: 1, totalRowCount: 9 };
  const base = {
    sample: partial,
    rows,
    drawsOneProfile: false,
    hasPeriod: false,
    before: null,
    rowLimitChanged: false,
  };
  assert.deepEqual(previewWindowFor(base), {
    offersRows: true,
    offersPaging: true,
    earliest: "2024-03-01T00:00:00.000Z",
    startOfRecord: false,
  });
  const whole = previewWindowFor({
    ...base,
    sample: { rowCount: 1, totalRowCount: 1 },
  });
  assert.equal(whole.offersRows, false);
  assert.equal(whole.offersPaging, false);
  assert.equal(
    previewWindowFor({ ...base, drawsOneProfile: true }).offersRows,
    false,
  );
  const period = previewWindowFor({ ...base, hasPeriod: true });
  assert.equal(period.offersRows, true);
  assert.equal(period.offersPaging, false);
});
