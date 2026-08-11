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

// The camera a visit without ?lat/?lon/?zoom opens at. Map.jsx builds the
// MapLibre instance from these, and MapStateProvider seeds its own view state
// from them: the map only reports its camera once it has finished loading, and
// everything keyed off the zoom (the legend ramps above all) would otherwise
// have to treat "not loaded yet" as "no zoom".
export const defaultMapCenter = { lat: 60, lon: -150 }
export const defaultMapZoom = 2

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

// CHS NONNA bathymetry (see basemapStyle.js). The zooms the two NONNA raster
// layers fade across; exported so the layers and the legend entry that
// describes them cannot drift apart.
export const bathymetryFadeInZoom = 10
export const bathymetryFullZoom = 12
// Only claim the ramp once the raster is at least half opaque — at the fade-in
// zoom itself it is drawn at zero opacity, and a legend for an invisible layer
// is worse than none.
export const bathymetryLegendMinZoom =
  (bathymetryFadeInZoom + bathymetryFullZoom) / 2

// The NONNA depth ramp, as (metres, colour) anchors.
//
// CHS publishes NONNA as pre-rendered RGB — the GeoServer style is a plain
// "Opaque Raster" and GetFeatureInfo returns three colour bands, not depths —
// so there is no colour map to read from the service and no GetLegendGraphic
// worth requesting. These anchors were instead recovered from the tiles: ~730
// NONNA 100 pixels sampled across the Scotian Shelf and slope, the Labrador
// Sea, the Gulf of St. Lawrence, the BC shelf and slope, the Bay of Fundy and
// three harbours, each paired with the GMRT depth at the same coordinate, then
// reduced to the median colour per log-spaced depth band. The ramp came back
// monotone and consistent between coasts, which is what makes a single legend
// legitimate: red at the surface through green and teal across the first ~25 m,
// into blue that darkens the rest of the way to the abyssal plain.
//
// So the colours are exactly CHS's, but the depth axis is calibrated rather
// than declared — good to the band, not to the metre. legendBathymetryTitle
// says as much to the user.
export const bathymetryColorScale = [
  { depth: 2, color: '#c31800' },
  { depth: 4, color: '#c36200' },
  { depth: 8, color: '#c39200' },
  { depth: 12, color: '#0cba00' },
  { depth: 17, color: '#03ae1e' },
  { depth: 22, color: '#068a60' },
  { depth: 28, color: '#0966b9' },
  { depth: 35, color: '#0961bd' },
  { depth: 45, color: '#075bb8' },
  { depth: 60, color: '#0551ae' },
  { depth: 85, color: '#0346a1' },
  { depth: 120, color: '#003794' },
  { depth: 175, color: '#003491' },
  { depth: 250, color: '#00308e' },
  { depth: 390, color: '#002786' },
  { depth: 610, color: '#001a7d' },
  { depth: 870, color: '#000a72' },
  { depth: 1200, color: '#00006a' },
  { depth: 1750, color: '#000062' },
  { depth: 2450, color: '#00005b' },
  { depth: 3450, color: '#000052' },
  { depth: 4500, color: '#000045' }
]

// The bar is drawn in log-depth space: the ramp spends its whole bright half on
// the first 25 m, which a linear axis would crush into an invisible sliver.
// Decade ticks then fall at even spacings and read as the log axis they are.
export const bathymetryScaleMin = 1
export const bathymetryScaleMax = 5000
export const bathymetryTicks = [1, 10, 100, 1000, 5000]

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
