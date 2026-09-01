import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SWATCHES,
  defaultColorFor,
  formatColorsParam,
  normalizeColor,
  parseColorsParam
} from './previewColors.js'
import {
  MIN_TRACE_CONTRAST,
  contrastOnWhite,
  paletteColorFor
} from './erddapPalettes.js'

// The ten palettes that cover ~95% of declared usage, and the one colour each
// one is projected onto. Written out rather than derived, because this table is
// what a reader of the plot actually sees — and because "temperature is magenta,
// salinity is blue, chlorophyll is green" is the whole point of reading the
// publisher's colorBarPalette in the first place.
const PALETTE_COLORS = {
  KT_thermal: '#a52c60',
  KT_haline: '#1a5a92',
  KT_algae: '#187449',
  KT_deep: '#3b6688',
  KT_dense: '#7b569f',
  KT_solar: '#9e5c00',
  KT_turbid: '#6f5c3d',
  TopographyDepth: '#1a5b9e',
  YellowRed: '#e31a1c',
  Rainbow: '#0000ff'
}

test('every mapped palette answers with one colour', () => {
  for (const [name, expected] of Object.entries(PALETTE_COLORS)) {
    assert.equal(paletteColorFor(name), expected, name)
  }
})

test('every palette colour is dark enough to see on a white panel', () => {
  // The ends of a cmocean ramp are near-white or near-black; a marker drawn in
  // KT_algae's first stop (#d7f9d0) would be invisible.
  for (const [name, color] of Object.entries(PALETTE_COLORS)) {
    assert.ok(
      contrastOnWhite(color) >= MIN_TRACE_CONTRAST,
      `${name} ${color} at ${contrastOnWhite(color).toFixed(1)}:1`
    )
  }
})

test('an unmapped or missing palette answers with nothing', () => {
  // 82% of variables declare no palette at all, and 32 of the 42 ERDDAP ones are
  // not mapped — both fall through to the index list.
  assert.equal(paletteColorFor('Ocean'), undefined)
  assert.equal(paletteColorFor(''), undefined)
  assert.equal(paletteColorFor(undefined), undefined)
})

test("a declared palette beats the variable's place in the list", () => {
  assert.equal(defaultColorFor({ palette: 'KT_thermal' }, 3), '#a52c60')
  assert.equal(defaultColorFor({ palette: 'Ocean' }, 3), SWATCHES[3])
})

test('without a palette the colour is the panel position, and it wraps', () => {
  assert.equal(defaultColorFor({}, 0), SWATCHES[0])
  assert.equal(defaultColorFor(undefined, 1), SWATCHES[1])
  assert.equal(defaultColorFor(null, SWATCHES.length), SWATCHES[0])
  assert.equal(defaultColorFor(null, SWATCHES.length + 2), SWATCHES[2])
  // A missing index is the first panel, not a crash.
  assert.equal(defaultColorFor(null, undefined), SWATCHES[0])
})

test('the swatch list is distinct — the point of it is telling panels apart', () => {
  assert.equal(new Set(SWATCHES).size, SWATCHES.length)
  SWATCHES.forEach((hex) => assert.equal(normalizeColor(hex), hex))
})

test('a colour is one spelling: six lowercase digits behind a hash', () => {
  assert.equal(normalizeColor('#A52C60'), '#a52c60')
  assert.equal(normalizeColor('a52c60'), '#a52c60')
  assert.equal(normalizeColor(' #a52c60 '), '#a52c60')
  // Three-digit hex, names and junk are all refused rather than guessed at.
  assert.equal(normalizeColor('#abc'), null)
  assert.equal(normalizeColor('red'), null)
  assert.equal(normalizeColor('#a52c6'), null)
  assert.equal(normalizeColor(''), null)
  assert.equal(normalizeColor(undefined), null)
  assert.equal(normalizeColor(0xa52c60), null)
})

test('the param round-trips, sorted so one choice is one URL', () => {
  const colors = { PSAL_01: '#1a5a92', TE90_01: '#a52c60' }
  const param = formatColorsParam(colors)
  assert.equal(param, 'PSAL_01~1a5a92,TE90_01~a52c60')
  assert.deepEqual(parseColorsParam(param), colors)
  // Picked in the other order, spelled the same way.
  assert.equal(formatColorsParam({ TE90_01: '#a52c60', PSAL_01: '#1a5a92' }), param)
})

test('nothing overridden writes no param at all', () => {
  assert.equal(formatColorsParam({}), null)
  assert.equal(formatColorsParam(null), null)
  assert.equal(formatColorsParam({ TE90_01: null }), null)
  assert.deepEqual(parseColorsParam(null), {})
  assert.deepEqual(parseColorsParam(''), {})
})

test('a link naming columns this dataset lacks loses only those', () => {
  const colors = parseColorsParam(
    'TE90_01~a52c60,NOT_HERE~ffffff,PSAL_01~1a5a92',
    (columnName) => columnName !== 'NOT_HERE'
  )
  assert.deepEqual(colors, { TE90_01: '#a52c60', PSAL_01: '#1a5a92' })
})

test('an unreadable entry is dropped, never defaulted', () => {
  // Half a colour map beats a thrown render: this has to survive a hand-edited
  // URL and anything an older or newer version wrote.
  assert.deepEqual(
    parseColorsParam('TE90_01~zzzzzz,PSAL_01,~ffffff,,PRES_01~123456'),
    { PRES_01: '#123456' }
  )
})

test('the pair separator survives the query string', () => {
  // URLSearchParams percent-encodes both `~` and `,` (as pvars already lives
  // with), so what matters is that they come back.
  const param = formatColorsParam({ TE90_01: '#a52c60', PSAL_01: '#1a5a92' })
  const written = new URLSearchParams({ pcolors: param }).toString()
  assert.ok(written.includes('%7E'), written)
  assert.deepEqual(
    parseColorsParam(new URLSearchParams(written).get('pcolors')),
    { PSAL_01: '#1a5a92', TE90_01: '#a52c60' }
  )
})
