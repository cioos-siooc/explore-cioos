// The plot's third dimension: one column whose values shade the markers of every
// selected variable, through one scale and one colourbar.
//
// This is the dimension the pre-faceting preview had, removed when colour became
// "which variable is this panel" and brought back beside it: the solid colour
// still says which variable, the ramp says what a third one was doing at each
// point. previewColors.js owns the first, this owns the second, and
// erddapPalettes.js is the ramp table both read.
//
// Pure on purpose — no React, no Plotly — so every rule below is assertable
// under `node --test`.

import { paletteFor } from "./erddapPalettes.js";
import { isTimeLike } from "./previewVariables.js";

// Never drawn, whoever asks for it: a rainbow ramp has no perceptual order, so
// its bands read as structure that is not in the data. The first three are the
// ERDDAP .cpt names that are one; Jet is Plotly's own, reachable only from a
// hand-edited link. erddapPalettes keeps its Rainbow ramp all the same — that
// one is projected down to a single solid trace colour, where ordering never
// arises.
const RAINBOWS = new Set(["Rainbow", "LightRainbow", "ReverseRainbow", "Jet"]);

export const DEFAULT_COLOR_SCALE = "Viridis";

// What the picker offers, in the order it offers it. The two built-ins are
// handed to Plotly BY NAME — its own Viridis is a seventeen-stop ramp and a
// second, worse copy of it here would only drift. The rest are the ERDDAP ramps
// already tabulated for the solid colours, so a publisher's intent stays
// pickable even on a variable that did not declare it.
export const COLOR_SCALES = [
  "Viridis",
  "Cividis",
  "KT_thermal",
  "KT_haline",
  "KT_algae",
  "KT_deep",
  "KT_dense",
  "KT_solar",
  "KT_turbid",
  "TopographyDepth",
  "YellowRed",
];

// Five stops each, for the 60x12px gradient chip in the picker and nothing else.
// The real ones are Plotly's and are not reachable from the dist bundle, so this
// is a likeness of the swatch, never of the mapping the figure draws.
const BUILT_IN_SWATCHES = {
  Viridis: [
    [0, "#440154"],
    [0.25, "#3b528b"],
    [0.5, "#21918c"],
    [0.75, "#5ec962"],
    [1, "#fde725"],
  ],
  Cividis: [
    [0, "#00224e"],
    [0.25, "#3b496c"],
    [0.5, "#707173"],
    [0.75, "#a59c74"],
    [1, "#fee838"],
  ],
};

// A scale name from a link or a picker, or null for "let the variable decide".
// Unknown and banned names answer the same way, so a hand-edited ?pzscale=Jet
// falls back to the automatic choice rather than to a rainbow.
export function normalizeColorScale(value) {
  const name = (value || "").trim();
  return COLOR_SCALES.includes(name) && !RAINBOWS.has(name) ? name : null;
}

// The form Plotly takes: a named scale it already carries, or one of our ramps.
export function colorScaleFor(name) {
  return paletteFor(name) || name;
}

// The stops a swatch is painted from — our ramps as they are, the built-ins as
// the likeness above.
export function swatchStopsFor(name) {
  return paletteFor(name) || BUILT_IN_SWATCHES[name] || [];
}

// The scale a column draws in when nobody has picked one: the publisher's own
// colorBarPalette, else Viridis — and never a rainbow. The NAME rather than the
// value, because the picker has to show which one that is.
export function autoScaleNameFor(variable) {
  const declared = variable && variable.palette;
  return declared && !RAINBOWS.has(declared) && paletteFor(declared)
    ? declared
    : DEFAULT_COLOR_SCALE;
}

/**
 * The scale a colour column is drawn in: the user's pick, else the publisher's
 * own colorBarPalette, else Viridis — and never a rainbow, whichever of the
 * three asked for one.
 */
export function colorScaleForVariable(variable, picked) {
  return colorScaleFor(
    normalizeColorScale(picked) || autoScaleNameFor(variable),
  );
}

// WHY colorBarScale: "Log" IS IGNORED
// Plotly maps a marker colourscale linearly at every level — there is no type on
// a colour axis. Honouring Log would mean transforming the values to log10 here,
// dropping every value at or below zero (which is exactly what the quantities
// declaring Log are full of: a chlorophyll with true zeros, a column with -999
// fills), and then hand-labelling decade ticks so the bar still reads in the
// published units. That is a second feature with its own failure mode, so the
// field stays unread and this comment is the record of why.

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_COUNT = 4;

// min/max by loop, never Math.min(...values): a preview payload is a thousand
// rows and the spread form is an argument list.
function extentOf(values) {
  let low = Infinity;
  let high = -Infinity;
  values.forEach((value) => {
    if (value === null) return;
    if (value < low) low = value;
    if (value > high) high = value;
  });
  return high > low ? [low, high] : null;
}

const utc = (epochMs) => new Date(epochMs).toISOString();

// A gap, not a zero. Number(null) and Number("") are both 0, which would paint
// an empty cell at the bottom of the ramp and drag the whole range down with it.
function numberOrGap(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Four timestamps standing in for the epoch milliseconds the colour axis really
// carries. Dates once the window is wider than a couple of days, clock times
// below that — a profile cast and a season are both common here.
export function timeTicksFor(values) {
  const extent = extentOf(values);
  if (!extent) return null;
  const [low, high] = extent;
  const asDates = high - low > 2 * DAY_MS;
  const tickvals = Array.from(
    { length: TICK_COUNT },
    (_, index) => low + ((high - low) * index) / (TICK_COUNT - 1),
  );
  return {
    tickmode: "array",
    tickvals,
    ticktext: tickvals.map((value) =>
      asDates ? utc(value).slice(0, 10) : utc(value).slice(11, 16),
    ),
  };
}

/**
 * The colour column's values ready for `marker.color`, what the hover should
 * print instead of them, and the ticks the bar needs — or null when this column
 * carries no ramp at all.
 *
 * Time is the case that needs all three: ERDDAP publishes it as an ISO string,
 * Plotly can only ramp over numbers, and epoch milliseconds are not something
 * anyone wants to read off a hover box or a colourbar.
 *
 * A string column carries no order, so it carries no ramp. Plotly agrees
 * silently — it wants one numeric entry before it honours a colour axis at all —
 * and silence is the reason this answers null rather than leaving the figure to
 * find out.
 */
export function colorDimensionFor(variable, data) {
  if (!variable) return null;
  const raw = (data || []).map((row) => row && row[variable.columnName]);

  if (isTimeLike(variable)) {
    const values = raw.map((value) => {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    });
    if (!values.some((value) => value !== null)) return null;
    return { values, hoverValues: raw, ticks: timeTicksFor(values) };
  }

  if (!variable.isNumeric) return null;

  const values = raw.map(numberOrGap);
  return values.some((value) => value !== null)
    ? { values, hoverValues: values, ticks: null }
    : null;
}
