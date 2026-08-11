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

export const colorScale = [
  '#52A79B',
  '#4A968C',
  '#3D7B73',
  '#2F6059',
  '#224440',
  '#1B3733',
  '#142926'
]

export const trajectoryColorScale = [
  '#D5C9EE',
  '#C4B3E6',
  '#B29CDD',
  '#9F86D3',
  '#8C71C7',
  '#7A5DBA',
  '#6749AC'
]

// OBIS occurrence coverage hexes. Amber, to stay legible against the green
// profile ramp, the purple trajectory ramp and the teal griddap outlines.
export const obisColorScale = [
  '#FBE3BE',
  '#F6CE92',
  '#EFB566',
  '#E39B3D',
  '#CE8025',
  '#B06718',
  '#8C4F0F'
]

// Hexes holding BOTH trajectory and OBIS cells. A plum/rose family reading as
// purple + amber, so a mixed hex is never mistaken for either pure ramp.
export const mixedColorScale = [
  '#F0D3DC',
  '#E3B4C4',
  '#D394AC',
  '#BE7594',
  '#A55B7D',
  '#894567',
  '#6B3350'
]

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
