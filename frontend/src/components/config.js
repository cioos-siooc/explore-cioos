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

// What the hex ramp counts. 'days' is the span of time covered; 'records' is the
// amount of data actually collected (measurements / occurrence records /
// position fixes); 'datasets' is how many distinct datasets a hexagon holds. See
// web-api/utils/hexMetric.js — the wire values must match.
//
// In the order the picker offers them, and the allowlist a ?metric= param is
// checked against.
//
// 'datasets' is the one to reach for when the record counts bunch up: they run
// over eight orders of magnitude and are dominated by a few high-rate
// instruments, whereas dataset counts are small integers and spread evenly
// across the ramp.
export const HEX_METRICS = ['days', 'records', 'datasets']

// Days of data leads, and is what the map opens on. It means one thing across
// all three sources, where 'records' sums three different units (and some of
// those counts are extrapolated rather than measured — see the caveat in
// web-api/utils/hexMetric.js), so it is the honest first reading. A share link
// overrides it with ?metric=, and the user's own pick is remembered.
export const DEFAULT_HEX_METRIC = 'days'

// What the API counts when a query carries no `metric` param at all (see
// DEFAULT_METRIC in web-api/utils/hexMetric.js). ONLY this value may be left out
// of a tile or /legend URL: omitting any other would ramp the colours against a
// count nobody asked for. It is deliberately not DEFAULT_HEX_METRIC — the two
// were the same value until the map's default moved to days, and conflating them
// again would silently paint record counts under a "days of data" title.
export const API_DEFAULT_HEX_METRIC = 'records'

// Where the hex aggregates give way to individual markers. Was a bare 7 in
// Map.jsx (hexMaxZoom), MapStateProvider and the Legend; the marker tier's
// pinned metric below makes those three agree by necessity rather than by
// coincidence, so the number lives in one place.
export const MARKER_MIN_ZOOM = 7

// Is the camera in the marker tier? Not inlined as a comparison because the two
// obvious spellings disagree on the two non-numeric zooms this actually sees:
// mapView starts as {} (zoom undefined, before the map reports its first view)
// and a share link's ?zoom= arrives as a string. `undefined < 7` is false, so
// the "hexes" test silently reads the world view as the marker tier, while
// `undefined >= 7` is also false, so the "markers" test reads it correctly —
// two call sites, two answers, for the same camera. Coerce, and treat an
// unknown zoom as the hex tier: the default camera is the whole world.
export const isMarkerTier = (zoom) => Number(zoom) >= MARKER_MIN_ZOOM

// The marker tier ignores the metric above and always counts days of data.
// Marker *size* is the only "how much" channel a point has, and area is a weak
// one: measurement counts run over eight orders of magnitude, so a log radius
// ramp over them leaves nearly every marker at the same size. Days of data
// spans three or four orders instead, which a radius can actually show. The
// hex ramp keeps the metric switcher — colour has the range to carry it.
export const MARKER_METRIC = 'days'

// The basemap hand-off window (see basemapStyle.js): the zooms over which the
// world view (EMODnet bathymetry raster, water tint, drawn coastline) gives way
// to the local view (Esri imagery + CHS NONNA soundings). Every layer that
// fades in or out during the hand-off reads these two numbers, so the swap
// stays a single coordinated event rather than several loosely-aligned ones.
//
// It used to run z10 → z12: a two-zoom cross-fade that left the middle of the
// range showing both rasters at partial opacity, with the satellite still
// half-transparent and NONNA barely readable through most of it. It now
// completes at z10 and takes half a zoom to do it, so a harbour view is fully
// on imagery and full-strength soundings rather than in a long blend.
export const basemapHandoffStartZoom = 9.5
export const basemapHandoffEndZoom = 10
// A short lead-in where the incoming rasters are requested but still drawn at
// zero opacity. The fade is now too quick to double as a warm-up: without this
// the first frame of a sharp swap would be whatever parent tiles happen to be
// cached. Keeps tiles off the wire at world zooms, where they are useless.
export const basemapPrewarmZoom = 9

// CHS NONNA bathymetry rides the same window — exported under its own names so
// the raster layers and the legend entry that describes them cannot drift apart.
export const bathymetryFadeInZoom = basemapHandoffStartZoom
export const bathymetryFullZoom = basemapHandoffEndZoom
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
