// ERDDAP `colorBarPalette` names mapped to colours. The server's .cpt files 404
// (/erddap/download/*.cpt, /erddap/images/*.cpt), so the mapping lives here.
// These ten cover ~95% of declared usage in the OGSL catalogue; the rest fall
// through to the index palette in previewColors.js. KT_* are cmocean.
// Whole ramps are kept though only one stop is used: they cannot be re-derived.

// Five-stop approximations in Plotly's [position, css-colour] form.
const PALETTES = {
  KT_thermal: [
    [0, "#042333"],
    [0.25, "#5b1a72"],
    [0.5, "#a52c60"],
    [0.75, "#e97158"],
    [1, "#f9e07d"],
  ],
  KT_haline: [
    [0, "#2a186c"],
    [0.25, "#1a5a92"],
    [0.5, "#1f8f8b"],
    [0.75, "#5cbf6e"],
    [1, "#fdea45"],
  ],
  KT_algae: [
    [0, "#d7f9d0"],
    [0.25, "#8ed99a"],
    [0.5, "#41a96f"],
    [0.75, "#187449"],
    [1, "#1a3c26"],
  ],
  KT_deep: [
    [0, "#fdfecc"],
    [0.25, "#8fd6a5"],
    [0.5, "#4b9e9e"],
    [0.75, "#3b6688"],
    [1, "#2b2a53"],
  ],
  KT_dense: [
    [0, "#e6f1f1"],
    [0.25, "#96c0d0"],
    [0.5, "#7a8fc0"],
    [0.75, "#7b569f"],
    [1, "#571d54"],
  ],
  KT_solar: [
    [0, "#331317"],
    [0.25, "#6b3200"],
    [0.5, "#9e5c00"],
    [0.75, "#c99000"],
    [1, "#e8ed70"],
  ],
  KT_turbid: [
    [0, "#e9f6b7"],
    [0.25, "#c6c069"],
    [0.5, "#a08a4b"],
    [0.75, "#6f5c3d"],
    [1, "#3a3327"],
  ],
  TopographyDepth: [
    [0, "#04295c"],
    [0.25, "#1a5b9e"],
    [0.5, "#5192c4"],
    [0.75, "#a8cbe0"],
    [1, "#e8f2f7"],
  ],
  YellowRed: [
    [0, "#ffffcc"],
    [0.25, "#fed976"],
    [0.5, "#fd8d3c"],
    [0.75, "#e31a1c"],
    [1, "#800026"],
  ],
  Rainbow: [
    [0, "#4b0082"],
    [0.25, "#0000ff"],
    [0.5, "#00ff00"],
    [0.75, "#ffa500"],
    [1, "#ff0000"],
  ],
};

export function paletteFor(name) {
  return name ? PALETTES[name] : undefined;
}

// sRGB relative luminance (WCAG 2.x), for #rrggbb only — every stop above is
// written that way.
function luminance(hex) {
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastOnWhite(hex) {
  return 1.05 / (luminance(hex) + 0.05);
}

// Between WCAG's 3 (large text) and 4.5 (body text); 4 is what lets every
// mapped palette answer with a stop it actually declares.
export const MIN_TRACE_CONTRAST = 4;

// Middle outwards: a cmocean ramp's middle is its most saturated part, its ends
// near-white and near-black.
function sampleOrder(length) {
  const middle = Math.floor((length - 1) / 2);
  return Array.from({ length }, (_, index) => index).sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle) || b - a,
  );
}

// Sampled rather than tabulated so editing a ramp cannot leave a stale
// hand-picked colour behind; current outputs are asserted in previewColors.test.mjs.
export function paletteColorFor(name) {
  const ramp = paletteFor(name);
  if (!ramp || !ramp.length) return undefined;
  const order = sampleOrder(ramp.length);
  const readable = order.find(
    (index) => contrastOnWhite(ramp[index][1]) >= MIN_TRACE_CONTRAST,
  );
  if (readable !== undefined) return ramp[readable][1];
  // No stop clears the floor: the darkest one is still the best available.
  return order.reduce(
    (best, index) =>
      contrastOnWhite(ramp[index][1]) > contrastOnWhite(best)
        ? ramp[index][1]
        : best,
    ramp[order[0]][1],
  );
}
