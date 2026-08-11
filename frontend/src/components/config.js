export const defaultEovsSelected = []
export const defaultPlatformsSelected = []
export const defaultOrgsSelected = []
export const defaultDatatsetsSelected = []
export const defaultErddapServersSelected = []
export const defaultStartDate = '1900-01-01'
export const defaultEndDate = new Date().toISOString().split('T')[0]
export const defaultStartDepth = 0
export const defaultEndDepth = 12000

export const defaultScientificNamesSelected = []
export const defaultObisNodesSelected = []

export const defaultQuery = {
  startDate: defaultStartDate,
  endDate: defaultEndDate,
  startDepth: defaultStartDepth,
  endDepth: defaultEndDepth,
  scientificNamesSelected: defaultScientificNamesSelected,
  obisNodesSelected: defaultObisNodesSelected
}

// Basemap selection: 'emodnet' (bathymetry raster + vector labels, default)
// or 'arcgis-ocean' (Esri World Ocean Base). See components/Map/basemapStyle.js.
export const basemap = 'emodnet'

// The one hex ramp. Every hexagon on the map — the combined hexes below z7 and
// the trajectory/OBIS coverage hexes at and above it — is painted from this,
// so hex darkness means the same thing at every zoom.
//
// It used to be four ramps: this green one plus purple for trajectory-only
// hexes, amber for OBIS-only and plum for hexes holding both. Together with
// the 12-colour platform palette on the point markers that put four colour
// families on screen at once above z7, and a reader had to decode hue before
// they could read density. What a hex holds now lives in its hover tooltip and
// in the layer toggles; colour is reserved for how much.
//
// Twelve stops, not seven, so MapLibre's interpolation between them reads as
// one continuous wash rather than a set of bands. The colours are fully
// opaque: the whole ramp is drawn at a single layer transparency (hexOpacity in
// Map.jsx), so a hexagon's alpha says nothing about its count and only its
// colour does.
//
// The path is teal-light -> primary -> navy, all CIOOS tokens, sampled at even
// L* steps (~6.4 apart) so no two neighbouring stops read as the same shade.
// It starts at --cioos-teal-light (#C6E3DF) rather than the near-white sand it
// used to open with: the pale head washed out over the basemap, so the sparsest
// hexes read as a gap in the data instead of as one count.
export const colorScale = [
  '#C6E3DF', // teal-light
  '#AAD3CD',
  '#8DC4BC',
  '#6EB5AA',
  '#55A598',
  '#469387',
  '#3C8277',
  '#347069',
  '#2B5F5C',
  '#244F4F',
  '#1D3E43',
  '#152F37' // navy
]

// Hex outline colour. White reads as a cell separator against every part of the
// ramp — a mid-ramp teal disappeared into the fills it was meant to divide.
export const hexOutlineColor = '#FFFFFF'

// What the hex ramp counts. 'records' is the amount of data actually collected
// (measurements / occurrence records / position fixes); 'days' is the span
// covered; 'datasets' is how many distinct datasets a hexagon holds. See
// web-api/utils/hexMetric.js — the wire values must match.
//
// 'datasets' is the one to reach for when the record counts bunch up: they run
// over eight orders of magnitude and are dominated by a few high-rate
// instruments, whereas dataset counts are small integers and spread evenly
// across the ramp.
export const HEX_METRICS = ['records', 'days', 'datasets']
export const DEFAULT_HEX_METRIC = 'records'

// Tracks mode (trajectory track lines + time scrub bar)
// 'all' = no trailing cutoff: every platform's full track up to the scrub
// date. Episodic trajectory datasets (a 2017-19 ferry, a 2016 glider
// mission, seasonal ship expeditions) are invisible in a short trail unless
// the user already knows each deployment's dates, so 'all' is the most
// discoverable trail. It is NOT the default, though: at full-catalogue scale
// 'all' assembles every platform's entire multi-decade track into each tile
// (100k+ line features, 400k+ vertices at low zoom) and overwhelms the
// renderer. A bounded default keeps the tiles ~20x smaller; users who want
// full history opt into 'all'. The tracks source has no minzoom (lines render
// at every zoom), so 'all' while zoomed out is the heavy case — guarded by the
// bounded default, the zoom gate below, the maxzoom cap in Map.jsx and the
// head-symbol culling, which keep the common case from crashing the tab.
export const TRAIL_ALL = 'all'
export const defaultTrailingDays = 90
export const trailingWindowOptions = [7, 14, 30, 90, 180, 365, TRAIL_ALL]

// Zoom gate for the long trails. Tile cost grows superlinearly with the window
// and is worst zoomed out, where one tile can assemble the whole catalogue.
// Measured per uncached tile at z2-z5: 90 days ~7 KB / 11 ms, one year
// ~14 KB / 70 ms, 'all' ~380 KB / 1.8 s. Dropping the long windows outright
// would be wrong — the trajectory hexes draw all-time coverage, so tracks that
// cannot reach as far back read as broken — so instead the long windows are
// clamped to longTrailMaxDays below longTrailMinZoom, and load in full at or
// above it, where a tile covers a small enough area to afford them. z5 is also
// where the head-symbol collision culling starts to matter (see Map.jsx).
export const longTrailMinZoom = 5
export const longTrailMaxDays = 365

// The trail actually loaded at this zoom: the requested window at or above
// longTrailMinZoom, clamped to longTrailMaxDays below it. Shared by the tracks
// tile URL builder and the legend/TimeBar, so the UI never claims a window the
// map is not drawing. An unknown zoom clamps, which is the cheap, honest guess.
export function effectiveTrailingDays (trailing, zoom) {
  if (zoom != null && zoom >= longTrailMinZoom) return trailing
  if (trailing === TRAIL_ALL) return longTrailMaxDays
  return Math.min(trailing, longTrailMaxDays)
}
// Scrub bar domain start; today is the end. Argo-era default.
export const tracksMinDate = '2000-01-01'
export const trackLineColor = '#6749AC'
export const selectedTrackColor = '#E3285E'

export const languages = [
  {
    code: 'en',
    name: 'English'
  },
  {
    code: 'fr',
    name: 'Français'
  }
]
