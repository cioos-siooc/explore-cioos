// Pure on purpose: the param codec has to be assertable under `node --test`, and
// usePreviewPlotParams (which owns the param) imports react-router.

import { paletteColorFor } from "./erddapPalettes.js";

// For the 82% of variables with no colorBarPalette. Extended past ten so a
// 14-column selection stays distinguishable.
export const SWATCHES = [
  "#2ca02c",
  "#1f77b4",
  "#d62728",
  "#ff7f0e",
  "#9467bd",
  "#8c564b",
  "#17becf",
  "#e377c2",
  "#bcbd22",
  "#7f7f7f",
  "#393b79",
  "#637939",
];

export function defaultColorFor(variable, index) {
  const position =
    (((index || 0) % SWATCHES.length) + SWATCHES.length) % SWATCHES.length;
  return paletteColorFor(variable && variable.palette) || SWATCHES[position];
}

const HEX = /^#?([0-9a-f]{6})$/i;

// Six digits only: it is what <input type="color"> emits, and a three-digit form
// would mean two spellings of one colour in a link.
export function normalizeColor(value) {
  const match = typeof value === "string" && value.trim().match(HEX);
  return match ? `#${match[1].toLowerCase()}` : null;
}

const PAIR = "~";
const SEPARATOR = ",";

// 'TE90_01~a52c60,PSAL_01~1a5a92' -> { TE90_01: '#a52c60', PSAL_01: '#1a5a92' }
// Unreadable entries are dropped: half a colour map beats a thrown render on a
// hand-edited or foreign link.
export function parseColorsParam(value, isKnown) {
  const colors = {};
  (value || "").split(SEPARATOR).forEach((entry) => {
    const [columnName, hex] = entry.split(PAIR);
    const color = normalizeColor(hex);
    const name = (columnName || "").trim();
    if (!name || !color) return;
    if (isKnown && !isKnown(name)) return;
    colors[name] = color;
  });
  return colors;
}

// Null deletes the param; sorted so the same choices always spell the same URL.
export function formatColorsParam(colors) {
  const entries = Object.keys(colors || {})
    .sort()
    .map((columnName) => [columnName, normalizeColor(colors[columnName])])
    .filter(([, color]) => color)
    .map(([columnName, color]) => `${columnName}${PAIR}${color.slice(1)}`);
  return entries.length ? entries.join(SEPARATOR) : null;
}
