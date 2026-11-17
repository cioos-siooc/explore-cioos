// Names the panel: a solid colour per variable for its line;
// previewColorScales.js takes the markers.
// Pure on purpose: the param codec has to be assertable under `node --test`, and
// usePreviewPlotParams (which owns the param) imports react-router.

import { paletteColorFor } from "./erddapPalettes.js";

// For the 82% of variables with no colorBarPalette. Led by the Okabe-Ito hues,
// which stay apart under every common colour-vision deficiency, minus its
// yellow (unreadable as a line on white) and its orange (the app's grid amber).
// Violet and goldenrod are kept out too: on this app they mean a trajectory and
// the last map click. Extended past ten so a 14-column selection stays
// distinguishable.
export const SWATCHES = [
  "#0072b2",
  "#d55e00",
  "#009e73",
  "#cc79a7",
  "#56b4e9",
  "#882255",
  "#8c510a",
  "#5c6b20",
  "#4b5d8a",
  "#c26a77",
  "#2e6b5e",
  "#7a6a4f",
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

// Each column's line colour: the user's pick, else its default — unless that
// default is already another column's, which on one shared plot would make two
// curves (and their axes) indistinguishable; it then takes the first unused
// swatch.
export function distinctColorsFor(columnNames, variablesByName, overrides) {
  const used = new Set();
  const colors = {};
  columnNames.forEach((columnName, index) => {
    const picked = overrides && overrides[columnName];
    let color =
      picked || defaultColorFor(variablesByName.get(columnName), index);
    if (!picked && used.has(color)) {
      color = SWATCHES.find((swatch) => !used.has(swatch)) || color;
    }
    used.add(color);
    colors[columnName] = color;
  });
  return colors;
}
