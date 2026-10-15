import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleLinear } from "d3-scale";

import {
  coloredLineBinsFor,
  lineBinLimitFor,
  BIN_BUDGET,
  MIN_STEP_PX,
  PERCEPTUAL_STEPS,
} from "./previewColoredLine.js";
import { colorScaleFor } from "./previewColorScales.js";

const VIRIDIS = colorScaleFor("Viridis");
const FALLBACK = "#123456";
// The ramp over range [0, 100], spelled the way the module spells colours.
const ramp = scaleLinear()
  .domain(VIRIDIS.map(([position]) => position * 100))
  .range(VIRIDIS.map(([, color]) => color));

const binsFor = (rows, extra = {}) =>
  coloredLineBinsFor({
    sharedValues: rows.map((_, index) => index),
    panelValues: rows.map(([panel]) => panel),
    colorValues: rows.map(([, color]) => color),
    range: [0, 100],
    stops: VIRIDIS,
    binLimit: 32,
    fallbackColor: FALLBACK,
    ...extra,
  });

// Every drawn segment as "start>end" shared values, over all groups.
function segmentsOf(groups) {
  const segments = [];
  groups.forEach(({ sharedValues }) => {
    for (let index = 0; index < sharedValues.length - 1; index += 1) {
      const [start, end] = [sharedValues[index], sharedValues[index + 1]];
      if (start !== null && end !== null) segments.push(`${start}>${end}`);
    }
  });
  return segments.sort();
}

// --- how many bins -----------------------------------------------------------

test("the bin limit is the perceptual cap when nothing tighter applies", () => {
  assert.equal(
    lineBinLimitFor({ panelCount: 1, axisPixels: 2000 }),
    PERCEPTUAL_STEPS,
  );
});

test("more panels share the trace budget", () => {
  assert.equal(lineBinLimitFor({ panelCount: 6, axisPixels: 2000 }), 32);
  assert.equal(
    lineBinLimitFor({ panelCount: 4, axisPixels: 2000 }),
    Math.floor(BIN_BUDGET / 4),
  );
});

test("a short axis cannot show a step narrower than a few pixels", () => {
  assert.equal(
    lineBinLimitFor({ panelCount: 1, axisPixels: 60 }),
    60 / MIN_STEP_PX,
  );
});

test("an unmeasured plot is bounded by the other limits alone, never below one", () => {
  assert.equal(lineBinLimitFor({ panelCount: 1 }), PERCEPTUAL_STEPS);
  assert.equal(lineBinLimitFor({ panelCount: 1, axisPixels: 1 }), 1);
});

// --- the groups --------------------------------------------------------------

test("a short line gets each segment's own colour, not a bin's", () => {
  const groups = binsFor([
    [1, 0],
    [2, 10],
    [3, 100],
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map(({ color }) => color),
    [ramp(5), ramp(55)],
  );
});

test("a column with few distinct colours is drawn in exactly those", () => {
  const rows = Array.from({ length: 200 }, (_, index) => [
    index,
    index < 100 ? 0 : 100,
  ]);
  const groups = binsFor(rows, { binLimit: 4 });
  // Both ends of the ramp, and the one segment straddling them.
  assert.deepEqual(
    groups.map(({ color }) => color),
    [ramp(0), ramp(50), ramp(100)],
  );
});

test("a long line takes no more groups than its bin limit", () => {
  const rows = Array.from({ length: 1000 }, (_, index) => [
    Math.sin(index / 10),
    (index * 37) % 101,
  ]);
  const groups = binsFor(rows, { binLimit: 32 });
  assert.ok(groups.length <= 32, `${groups.length} groups`);
});

test("six panels of a 1000-row record stay within the trace budget", () => {
  const binLimit = lineBinLimitFor({ panelCount: 6, axisPixels: 900 });
  const rows = Array.from({ length: 1000 }, (_, index) => [
    index,
    (index * 7919) % 1000,
  ]);
  const total = Array.from(
    { length: 6 },
    () => binsFor(rows, { range: [0, 999], binLimit }).length,
  ).reduce((sum, count) => sum + count, 0);
  assert.ok(total <= BIN_BUDGET, `${total} traces`);
});

test("every segment is drawn exactly once", () => {
  const rows = Array.from({ length: 300 }, (_, index) => [
    index % 17,
    (index * 13) % 100,
  ]);
  const expected = Array.from(
    { length: 299 },
    (_, index) => `${index}>${index + 1}`,
  );
  assert.deepEqual(segmentsOf(binsFor(rows, { binLimit: 8 })), expected.sort());
});

test("each run starts on the point the line was already at", () => {
  // Continuity: a run that does not start where another ended would leave a gap.
  const rows = Array.from({ length: 50 }, (_, index) => [index, index * 2]);
  const groups = binsFor(rows, { binLimit: 5 });
  const runStarts = [];
  const runEnds = new Set();
  groups.forEach(({ sharedValues }) => {
    sharedValues.forEach((value, index) => {
      if (value === null) return;
      if (index === 0 || sharedValues[index - 1] === null)
        runStarts.push(value);
      if (index === sharedValues.length - 1 || sharedValues[index + 1] === null)
        runEnds.add(value);
    });
  });
  runStarts
    .filter((start) => start !== 0)
    .forEach((start) => assert.ok(runEnds.has(start), `run at ${start}`));
});

test("runs in the same group are split by a null, never joined across", () => {
  const groups = binsFor(
    [
      [1, 0],
      [2, 0],
      [3, 100],
      [4, 100],
      [5, 0],
      [6, 0],
    ],
    { binLimit: 2 },
  );
  const low = groups.find(({ panelValues }) => panelValues[0] === 1);
  assert.deepEqual(low.panelValues, [1, 2, null, 5, 6]);
});

test("a missing value breaks the line where Plotly would", () => {
  const groups = binsFor([
    [1, 0],
    [2, 0],
    [null, 0],
    [4, 0],
    [5, 0],
  ]);
  assert.deepEqual(segmentsOf(groups), ["0>1", "3>4"]);
});

test("a segment with no colour at either end keeps the panel's own", () => {
  const groups = binsFor([
    [1, 0],
    [2, null],
    [3, null],
    [4, 100],
  ]);
  const uncolored = groups.find(({ color }) => color === FALLBACK);
  assert.deepEqual(uncolored.panelValues, [2, 3]);
  // One known end is enough to colour the segments either side of it.
  assert.equal(groups.length, 3);
});

test("the lowest and highest bins sit at the ramp's two ends", () => {
  const rows = Array.from({ length: 101 }, (_, index) => [index, index]);
  const groups = binsFor(rows, { binLimit: 50 });
  assert.equal(groups[0].color, ramp(1));
  assert.equal(groups.at(-1).color, ramp(99));
});

test("one colour value throughout is drawn mid-ramp, as Plotly draws it", () => {
  const groups = binsFor(
    [
      [1, 5],
      [2, 5],
    ],
    { range: null },
  );
  assert.equal(groups[0].color, ramp(50));
});
