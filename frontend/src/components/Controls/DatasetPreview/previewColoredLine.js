// The line of a panel, shaded by the colour column like its markers.
//
// WHY BINS
// A Plotly scatter line takes ONE colour (`line.color` is not arrayOk, and no
// bundle but gl3d's scatter3d does better), so a ramp along a line means many
// traces. One trace per segment is exact but costs a trace per row — 6000 at six
// panels of a 1000-row record. Instead each segment is put in a colour bin and
// every bin is ONE trace, its runs split by nulls, the way Plotly breaks a line.
//
// WHY NOT A FIXED 32
// The bin count is the smallest of what can be seen (PERCEPTUAL_STEPS, and
// MIN_STEP_PX along the axis the line runs on) and what Plotly's SVG layer is
// given (BIN_BUDGET over the panels). A line whose segments take fewer distinct
// colours than that gets each one exactly, with no bins at all.
//
// Pure on purpose — no React, no Plotly — so every rule here is assertable under
// `node --test`.

import { scaleLinear } from "d3-scale";

export const PERCEPTUAL_STEPS = 64; // finer than this is invisible on these ramps
export const MIN_STEP_PX = 3;
export const BIN_BUDGET = 192; // 32 bins on each of six panels

const isGap = (value) =>
  value === null ||
  value === undefined ||
  value === "" ||
  (typeof value === "number" && !Number.isFinite(value));

/**
 * How many colour bins each panel's line may use: the same for every panel, so
 * the panels quantize alike. `axisPixels` is 0 until the plot is measured.
 */
export function lineBinLimitFor({ panelCount, axisPixels = 0 }) {
  const limits = [
    PERCEPTUAL_STEPS,
    Math.floor(BIN_BUDGET / Math.max(panelCount, 1)),
  ];
  if (axisPixels > 0) limits.push(Math.floor(axisPixels / MIN_STEP_PX));
  return Math.max(1, Math.min(...limits));
}

// Value -> CSS colour over the same stops and range as the layout's coloraxis,
// so line, markers and legend agree. A range of one value is drawn mid-ramp,
// which is where Plotly puts it (it widens cmin === cmax by 0.5 each side).
function rampFor(stops, range) {
  const colors = stops.map(([, color]) => color);
  if (!range) {
    const middle = scaleLinear()
      .domain(stops.map(([position]) => position))
      .range(colors)(0.5);
    return () => middle;
  }
  const [low, high] = range;
  return scaleLinear()
    .domain(stops.map(([position]) => low + position * (high - low)))
    .range(colors)
    .clamp(true);
}

// One end's value when the other is missing; null only when both are.
function segmentValue(start, end) {
  if (start === null) return end;
  if (end === null) return start;
  return (start + end) / 2;
}

const UNCOLORED = "uncolored";

/**
 * The line of one panel as colour groups, each `{ color, sharedValues,
 * panelValues }` with null between its runs. Every run starts on the last point
 * of the run before it, whatever its group, so the line has no gaps but the
 * data's own.
 *
 * @param colorValues numbers or null, one per row (colorDimensionFor's values)
 * @param range       [low, high] they were mapped over, or null for one value
 * @param stops       the ramp, [[position, colour], ...]
 * @param binLimit    from lineBinLimitFor()
 * @param fallbackColor what a segment with no colour at either end is drawn in
 */
export function coloredLineBinsFor({
  sharedValues,
  panelValues,
  colorValues,
  range,
  stops,
  binLimit,
  fallbackColor,
}) {
  const segments = [];
  for (let start = 0; start < panelValues.length - 1; start += 1) {
    const end = start + 1;
    const drawable = [start, end].every(
      (row) => !isGap(sharedValues[row]) && !isGap(panelValues[row]),
    );
    if (drawable)
      segments.push({
        start,
        value: segmentValue(colorValues[start], colorValues[end]),
      });
  }

  const colorAt = rampFor(stops, range);
  const distinctValues = new Set(
    segments.map(({ value }) => value).filter((value) => value !== null),
  );
  const exact = distinctValues.size <= binLimit;
  const [low, high] = range || [0, 0];
  const binWidth = (high - low) / binLimit;
  const binOf = (value) =>
    Math.min(binLimit - 1, Math.floor((value - low) / binWidth));

  const groups = new Map();
  const groupFor = (value) => {
    let key;
    let color;
    if (value === null) {
      key = UNCOLORED;
      color = fallbackColor;
    } else if (exact) {
      key = value;
      color = colorAt(value);
    } else {
      key = binOf(value);
      color = colorAt(low + (key + 0.5) * binWidth); // the bin's centre
    }
    if (!groups.has(key))
      groups.set(key, {
        color,
        sharedValues: [],
        panelValues: [],
        lastRow: -1,
      });
    return groups.get(key);
  };

  segments.forEach(({ start, value }) => {
    const group = groupFor(value);
    const push = (row) => {
      group.sharedValues.push(row === null ? null : sharedValues[row]);
      group.panelValues.push(row === null ? null : panelValues[row]);
    };
    if (group.lastRow !== start) {
      if (group.panelValues.length) push(null); // a break, not a jump
      push(start);
    }
    push(start + 1);
    group.lastRow = start + 1;
  });

  return [...groups.values()].map(({ color, sharedValues, panelValues }) => ({
    color,
    sharedValues,
    panelValues,
  }));
}
