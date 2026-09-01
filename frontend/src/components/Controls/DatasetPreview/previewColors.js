// One colour per plotted variable: where its default comes from, and how a
// user's override survives a link.
//
// This replaces the colour DIMENSION the preview used to have — one variable's
// values shading every panel through a shared colourscale and colourbar. With a
// panel per variable there is nothing to disambiguate inside a panel, so colour
// is free to say WHICH variable a panel draws instead of what its values are.
//
// Pure on purpose: the param codec has to be assertable under `node --test`, and
// usePreviewPlotParams (which owns the param) imports react-router.

import { paletteColorFor } from './erddapPalettes.js'

// The fallback palette, for the 82% of variables that declare no
// colorBarPalette. Extended past the usual ten so a 14-column selection stays
// distinguishable, and offered as-is in the picker.
export const SWATCHES = [
  '#2ca02c', '#1f77b4', '#d62728', '#ff7f0e', '#9467bd', '#8c564b',
  '#17becf', '#e377c2', '#bcbd22', '#7f7f7f', '#393b79', '#637939'
]

/**
 * The colour a variable draws in when the user has not said otherwise: the one
 * ERDDAP's own colorBarPalette implies, else the next colour along the list
 * above.
 *
 * The publisher's intent is worth honouring here in a way it was not worth
 * honouring for the colourbar: `KT_thermal` on a temperature and `KT_haline` on
 * a salinity mean the plot opens reading roughly the way an ERDDAP graph of the
 * same dataset does, with no choice made by anyone.
 */
export function defaultColorFor (variable, index) {
  const position = ((index || 0) % SWATCHES.length + SWATCHES.length) % SWATCHES.length
  return paletteColorFor(variable && variable.palette) || SWATCHES[position]
}

const HEX = /^#?([0-9a-f]{6})$/i

// '#rrggbb' lowercase, or null. Six digits only: it is what <input type="color">
// emits and what the param carries, so accepting the three-digit form would mean
// two spellings of one colour in a link.
export function normalizeColor (value) {
  const match = typeof value === 'string' && value.trim().match(HEX)
  return match ? `#${match[1].toLowerCase()}` : null
}

const PAIR = '~'
const SEPARATOR = ','

/**
 * 'TE90_01~a52c60,PSAL_01~1a5a92' -> { TE90_01: '#a52c60', PSAL_01: '#1a5a92' }
 *
 * Anything unreadable is dropped rather than defaulted: a link may name a column
 * this dataset does not have, or carry a colour some later version wrote
 * differently, and half a colour map is better than a thrown render. `isKnown`
 * is the column filter — omit it to keep every name.
 */
export function parseColorsParam (value, isKnown) {
  const colors = {}
  ;(value || '').split(SEPARATOR).forEach((entry) => {
    const [columnName, hex] = entry.split(PAIR)
    const color = normalizeColor(hex)
    const name = (columnName || '').trim()
    if (!name || !color) return
    if (isKnown && !isKnown(name)) return
    colors[name] = color
  })
  return colors
}

/**
 * The inverse, or null when nothing is overridden — which is what deletes the
 * param, so an untouched plot adds nothing to the link.
 *
 * Sorted by column name so the same set of choices always spells the same URL,
 * whatever order they were picked in.
 */
export function formatColorsParam (colors) {
  const entries = Object.keys(colors || {})
    .sort()
    .map((columnName) => [columnName, normalizeColor(colors[columnName])])
    .filter(([, color]) => color)
    .map(([columnName, color]) => `${columnName}${PAIR}${color.slice(1)}`)
  return entries.length ? entries.join(SEPARATOR) : null
}
