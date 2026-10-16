export const defaultEovsSelected = [];
export const defaultPlatformsSelected = [];
export const defaultOrgsSelected = [];
export const defaultDatatsetsSelected = [];
export const defaultErddapServersSelected = [];
export const defaultStartDate = "1900-01-01";
export const defaultEndDate = new Date().toISOString().split("T")[0];
export const defaultStartDepth = 0;
export const defaultEndDepth = 12000;

export const defaultScientificNamesSelected = [];
export const defaultObisNodesSelected = [];
// Listed before "show more": the two Canadian nodes the harvest is built
// around; the others only contribute datasets inside Canadian waters.
export const featuredObisNodes = ["OBIS Canada", "OTN-OBIS"];

// Also seeds MapStateProvider's view state: the map only reports its camera
// once loaded, and zoom-keyed consumers (the legend) would read "no zoom".
export const defaultMapCenter = { lat: 63.3, lon: -95.9 };
export const defaultMapZoom = 2.75;

export const defaultQuery = {
  startDate: defaultStartDate,
  endDate: defaultEndDate,
  startDepth: defaultStartDepth,
  endDepth: defaultEndDepth,
  scientificNamesSelected: defaultScientificNamesSelected,
  obisNodesSelected: defaultObisNodesSelected,
};

// The one hex ramp for every hexagon at every zoom, so darkness means the
// same thing everywhere; colour is reserved for "how much". Twelve stops so
// interpolation reads as one wash, fully opaque because the layer opacity is
// applied once (hexOpacity in Map.jsx). CIOOS tokens teal-light -> primary ->
// navy at even L* steps (~6.4); a paler head washed out over the basemap.
export const colorScale = [
  "#C6E3DF", // teal-light
  "#AAD3CD",
  "#8DC4BC",
  "#6EB5AA",
  "#55A598",
  "#469387",
  "#3C8277",
  "#347069",
  "#2B5F5C",
  "#244F4F",
  "#1D3E43",
  "#152F37", // navy
];

// White separates cells against every part of the ramp; a mid-ramp teal vanished.
export const hexOutlineColor = "#FFFFFF";

// Click answers (click-highlight-* and selected-track-* layers, highlighted
// rows). Goldenrod because greens, purple and amber already mean data layers.
// Must stay in step with --cioos-map-click in components/theme.css.
export const clickHighlightColor = "#DAA520";

// Days is the only count that means one thing across all sources. Must match
// web-api/utils/hexMetric.js; the API defaults to 'records' when ?metric= is
// absent, so this is written into every tile and /legend URL explicitly.
export const HEX_METRIC = "days";

export const MARKER_MIN_ZOOM = 7;

// Not inlined: mapView starts as {} and ?zoom= arrives as a string, and
// `undefined < 7` / `undefined >= 7` are both false, so the two spellings
// disagree. Coerce, treating an unknown zoom as the hex tier.
export const isMarkerTier = (zoom) => Number(zoom) >= MARKER_MIN_ZOOM;

// The zooms over which the world view (EMODnet raster, water tint, coastline)
// gives way to Esri imagery + CHS NONNA (see basemapStyle.js). Every fading
// layer reads these so the swap stays one coordinated event.
export const basemapHandoffStartZoom = 9.5;
export const basemapHandoffEndZoom = 10;
// Incoming rasters are requested here but drawn at zero opacity, so a sharp
// swap doesn't start on whatever parent tiles are cached, while keeping tiles
// off the wire at world zooms.
export const basemapPrewarmZoom = 9;

// Own names so the raster layers and their legend entry cannot drift apart.
export const bathymetryFadeInZoom = basemapHandoffStartZoom;
export const bathymetryFullZoom = basemapHandoffEndZoom;
// At the fade-in zoom the raster is still invisible; claim the ramp only once
// it is at least half opaque.
export const bathymetryLegendMinZoom =
  (bathymetryFadeInZoom + bathymetryFullZoom) / 2;

// Government of Canada serves every page as an -eng/-fra pair.
export const bathymetrySourceUrl = {
  en: "https://charts.gc.ca/data-gestion/nonna/index-eng.html",
  fr: "https://charts.gc.ca/data-gestion/nonna/index-fra.html",
};

// The NONNA depth ramp, as (metres, colour) anchors. CHS serves NONNA as
// pre-rendered RGB with no colour map or useful GetLegendGraphic, so these
// were recovered from ~730 tile pixels across both coasts paired with GMRT
// depths (median colour per log-spaced band): exact colours, but depths good
// to the band, not the metre (legendBathymetryTitle says so).
export const bathymetryColorScale = [
  { depth: 2, color: "#c31800" },
  { depth: 4, color: "#c36200" },
  { depth: 8, color: "#c39200" },
  { depth: 12, color: "#0cba00" },
  { depth: 17, color: "#03ae1e" },
  { depth: 22, color: "#068a60" },
  { depth: 28, color: "#0966b9" },
  { depth: 35, color: "#0961bd" },
  { depth: 45, color: "#075bb8" },
  { depth: 60, color: "#0551ae" },
  { depth: 85, color: "#0346a1" },
  { depth: 120, color: "#003794" },
  { depth: 175, color: "#003491" },
  { depth: 250, color: "#00308e" },
  { depth: 390, color: "#002786" },
  { depth: 610, color: "#001a7d" },
  { depth: 870, color: "#000a72" },
  { depth: 1200, color: "#00006a" },
  { depth: 1750, color: "#000062" },
  { depth: 2450, color: "#00005b" },
  { depth: 3450, color: "#000052" },
  { depth: 4500, color: "#000045" },
];

// Log-depth axis: the ramp spends its bright half on the first 25 m, which a
// linear axis would crush.
export const bathymetryScaleMin = 1;
export const bathymetryScaleMax = 5000;
export const bathymetryTicks = [1, 10, 100, 1000, 5000];

// 'all' = no trailing cutoff. Not the default: at full-catalogue scale it puts
// 100k+ line features (400k+ vertices) in each low-zoom tile and overwhelms
// the renderer; the bounded default keeps tiles ~20x smaller.
export const TRAIL_ALL = "all";
export const defaultTrailingDays = 90;
export const trailingWindowOptions = [7, 14, 30, 90, 180, 365, TRAIL_ALL];

// Measured per uncached tile at z2-z5: 90 days ~7 KB / 11 ms, one year
// ~14 KB / 70 ms, 'all' ~380 KB / 1.8 s. Long windows are clamped to
// longTrailMaxDays below this rather than dropped, since the trajectory hexes
// draw all-time coverage and shorter tracks would read as broken.
export const longTrailMinZoom = 5;
export const longTrailMaxDays = 365;

// Shared by the tracks tile URL and the legend/TimeBar, so the UI never claims
// a window the map is not drawing. An unknown zoom clamps.
export function effectiveTrailingDays(trailing, zoom) {
  if (zoom != null && zoom >= longTrailMinZoom) return trailing;
  if (trailing === TRAIL_ALL) return longTrailMaxDays;
  return Math.min(trailing, longTrailMaxDays);
}
// Argo-era default; today is the end.
export const tracksMinDate = "2000-01-01";
export const trackLineColor = "#6749AC";

export const languages = [
  {
    code: "en",
    name: "English",
  },
  {
    code: "fr",
    name: "Français",
  },
];

export const defaultRealtimeOnly = false;
