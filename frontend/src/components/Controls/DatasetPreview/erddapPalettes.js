// ERDDAP colour palettes, mapped to Plotly colorscales.
//
// A publisher declares its intended ramp per variable as `colorBarPalette`,
// naming one of 42 server-side .cpt files. Those files are not downloadable
// (/erddap/download/*.cpt and /erddap/images/*.cpt both 404), so the name-to-
// colour mapping has to live here.
//
// Only ten are mapped, because ten cover ~95% of declared usage across the OGSL
// catalogue: YellowRed 107 variables, KT_algae 58, KT_deep 20, KT_haline 17,
// TopographyDepth 16, KT_thermal 12, KT_solar 6, KT_dense 6, KT_turbid 5,
// Rainbow a small tail. The KT_* names are cmocean (Thyng et al.). Anything
// unmapped falls through to the index palette in previewColors.js — 82% declare
// no palette at all, so that fallback IS the common case.
//
// WHY WHOLE RAMPS FOR A SINGLE COLOUR
// Nothing draws a ramp any more: the colour dimension (one variable shading
// every panel, one colourbar) was replaced by one solid colour per variable, and
// paletteColorFor() below projects a ramp down to one of its stops. The ramps
// stay anyway, because they cannot be re-derived — see the 404s above — and
// because the projection is only defensible next to what it projects.

// Approximations of the cmocean ramps in Plotly's [position, css-colour] form.
// Five stops each: enough to be recognisable, small enough to read.
const PALETTES = {
  KT_thermal: [
    [0, '#042333'], [0.25, '#5b1a72'], [0.5, '#a52c60'],
    [0.75, '#e97158'], [1, '#f9e07d']
  ],
  KT_haline: [
    [0, '#2a186c'], [0.25, '#1a5a92'], [0.5, '#1f8f8b'],
    [0.75, '#5cbf6e'], [1, '#fdea45']
  ],
  KT_algae: [
    [0, '#d7f9d0'], [0.25, '#8ed99a'], [0.5, '#41a96f'],
    [0.75, '#187449'], [1, '#1a3c26']
  ],
  KT_deep: [
    [0, '#fdfecc'], [0.25, '#8fd6a5'], [0.5, '#4b9e9e'],
    [0.75, '#3b6688'], [1, '#2b2a53']
  ],
  KT_dense: [
    [0, '#e6f1f1'], [0.25, '#96c0d0'], [0.5, '#7a8fc0'],
    [0.75, '#7b569f'], [1, '#571d54']
  ],
  KT_solar: [
    [0, '#331317'], [0.25, '#6b3200'], [0.5, '#9e5c00'],
    [0.75, '#c99000'], [1, '#e8ed70']
  ],
  KT_turbid: [
    [0, '#e9f6b7'], [0.25, '#c6c069'], [0.5, '#a08a4b'],
    [0.75, '#6f5c3d'], [1, '#3a3327']
  ],
  TopographyDepth: [
    [0, '#04295c'], [0.25, '#1a5b9e'], [0.5, '#5192c4'],
    [0.75, '#a8cbe0'], [1, '#e8f2f7']
  ],
  YellowRed: [
    [0, '#ffffcc'], [0.25, '#fed976'], [0.5, '#fd8d3c'],
    [0.75, '#e31a1c'], [1, '#800026']
  ],
  Rainbow: [
    [0, '#4b0082'], [0.25, '#0000ff'], [0.5, '#00ff00'],
    [0.75, '#ffa500'], [1, '#ff0000']
  ]
}

// A palette name Plotly can use, or undefined.
export function paletteFor (name) {
  return name ? PALETTES[name] : undefined
}

// sRGB relative luminance (WCAG 2.x), for #rrggbb only — every stop above is
// written that way.
function luminance (hex) {
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

// Panels are drawn on white, so this is the contrast that decides whether a
// stop can be a marker.
export function contrastOnWhite (hex) {
  return 1.05 / (luminance(hex) + 0.05)
}

// 4:1 is below the 4.5 WCAG asks of body text and above the 3 it asks of large
// text — a 4px marker is neither, and 4 is what keeps every one of the ten
// palettes able to answer with a stop it actually declares.
export const MIN_TRACE_CONTRAST = 4

// Stop indices from the middle of a ramp outwards, ends last, the higher index
// first on a tie. The middle of a cmocean ramp is its most saturated part; the
// ends are the near-white and near-black the ramp fades to.
function sampleOrder (length) {
  const middle = Math.floor((length - 1) / 2)
  return Array.from({ length }, (_, index) => index).sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle) || b - a
  )
}

/**
 * One solid colour standing in for a whole ramp: walking out from the middle
 * stop, the first one that clears MIN_TRACE_CONTRAST against white.
 *
 * Sampled rather than tabulated so that editing a ramp above cannot leave a
 * hand-picked colour behind pointing at the old one. What it currently yields —
 * thermal magenta, haline blue, algae green, YellowRed red — is asserted in
 * previewColors.test.mjs, and so is the contrast floor.
 *
 * Two ramps can answer with near-identical colours (KT_haline #1a5a92 and
 * TopographyDepth #1a5b9e are both blue ramps), and two variables declaring the
 * same palette get the same colour. Each variable has its own panel, so a repeat
 * is not ambiguous the way it would be in an overlay — and every colour is
 * user-changeable.
 */
export function paletteColorFor (name) {
  const ramp = paletteFor(name)
  if (!ramp || !ramp.length) return undefined
  const order = sampleOrder(ramp.length)
  const readable = order.find(
    (index) => contrastOnWhite(ramp[index][1]) >= MIN_TRACE_CONTRAST
  )
  if (readable !== undefined) return ramp[readable][1]
  // No stop clears the floor: the darkest one is still the best available.
  return order.reduce(
    (best, index) =>
      contrastOnWhite(ramp[index][1]) > contrastOnWhite(best)
        ? ramp[index][1]
        : best,
    ramp[order[0]][1]
  )
}
