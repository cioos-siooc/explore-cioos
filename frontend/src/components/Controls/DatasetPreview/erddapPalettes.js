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
// unmapped falls through to the user's chosen scale, which is what happened to
// every variable before this file existed — 82% declare no palette at all, so
// the fallback IS the common case.

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

// Named scales that ship in the plotly-basic 3.x bundle, offered in the picker.
export const COLORSCALE_OPTIONS = [
  'Viridis', 'Cividis', 'Blues', 'Greens', 'Reds',
  'YlGnBu', 'YlOrRd', 'Hot', 'Bluered', 'RdBu',
  'Portland', 'Jet', 'Electric', 'Earth', 'Greys'
]

export const DEFAULT_COLORSCALE = 'Viridis'

// A palette name Plotly can use, or undefined.
export function paletteFor (name) {
  return name ? PALETTES[name] : undefined
}

export function hasPalette (name) {
  return Boolean(name && PALETTES[name])
}

// What to colour with: the user's explicit choice always wins, because a picker
// that silently ignores you is worse than no picker. The publisher's palette
// only applies while the choice is still the default.
export function colorscaleFor (variable, chosenScale) {
  if (chosenScale && chosenScale !== DEFAULT_COLORSCALE) return chosenScale
  const declared = variable && paletteFor(variable.palette)
  return declared || chosenScale || DEFAULT_COLORSCALE
}
