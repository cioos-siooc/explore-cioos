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

// download_scheduler deletes download zips after DOWNLOAD_RETENTION_DAYS.
export const downloadRetentionDays = 7;
export const defaultObisNodesSelected = [];
// Listed before "show more": the two Canadian nodes the harvest is built
// around; the others only contribute datasets inside Canadian waters.
export const featuredObisNodes = ["OBIS Canada", "OTN-OBIS"];

// [[west, south], [east, north]]: most of Canada with some of all three
// oceans. A box, not a centre and zoom, so every screen size frames the same
// area.
export const defaultMapBounds = [
  [-145, 40],
  [-45, 78],
];

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

// Griddap footprints at rest (base) and hovered (deep). Must stay in step with
// --cioos-grid and --cioos-grid-700 in components/theme.css.
export const gridCoverageColor = "#FBB03B";
export const gridCoverageDeepColor = "#C77F14";

// Features outside the focused dataset. Navy-tinted like every neutral, and
// paler than the "unknown" platform's slate so a dimmed marker can't pass for
// one.
export const dimmedFeatureColor = "#C9D4D6";

// The ramp's navy end: rings that must read over pale cells and pale markers.
export const mapInkColor = "#152F37";

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

// Fill opacity of the count hexes by zoom: the main hexes up to the marker
// tier, the coverage cells from there. Below the tier the floor stays high so
// a one-day cell reads as data, not as the water tint; at the tier the white
// edges mark each cell and the fill steps back for the markers; across the
// basemap hand-over it thins to a tint as the border takes over. Shared with
// the legend, whose bar is drawn as faint as the cells it keys.
export const MARKER_FADE_END_ZOOM = MARKER_MIN_ZOOM + 0.15;
export const HEX_FILL_OPACITY_STOPS = [
  [0, 0.85],
  [MARKER_MIN_ZOOM, 0.7],
  [MARKER_FADE_END_ZOOM, 0.45],
  [basemapHandoffStartZoom, 0.4],
  [basemapHandoffEndZoom, 0.2],
];
export function hexFillOpacityAt(zoom) {
  const z = Number(zoom);
  const stops = HEX_FILL_OPACITY_STOPS;
  if (!Number.isFinite(z) || z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, o1] = stops[i];
    if (z <= z1) {
      const [z0, o0] = stops[i - 1];
      return o0 + ((z - z0) / (z1 - z0)) * (o1 - o0);
    }
  }
  return stops[stops.length - 1][1];
}

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

// The NONNA depth ramps the viewer picks between, as (metres, colour) anchors,
// drawn by the color-relief layer in basemapStyle.js and the legend alike.
// 1 m stands in for 0 m, which a log axis can't place.
export const bathymetryPalettes = {
  // cmocean "deep", sampled evenly along the log-depth axis so the shallows
  // get as much of the ramp as the abyss; readable with any colour vision.
  deep: [
    { depth: 1, color: "#fdfecc" },
    { depth: 2, color: "#d2eeb5" },
    { depth: 4, color: "#a5dfa7" },
    { depth: 8, color: "#78cea3" },
    { depth: 17, color: "#5dbaa4" },
    { depth: 35, color: "#50a4a2" },
    { depth: 70, color: "#488e9e" },
    { depth: 145, color: "#427999" },
    { depth: 290, color: "#3e6495" },
    { depth: 590, color: "#404c8b" },
    { depth: 1200, color: "#3f396c" },
    { depth: 2450, color: "#352a4a" },
    { depth: 5000, color: "#281a2c" },
  ],
  // CHS's own NONNA colours, which its WMS serves baked into the tiles with no
  // style to read: recovered by pairing WMS pixels with the WCS sounding under
  // each, to within 6/255 per channel. Past 400 m, where NONNA 10 ran out of
  // samples, NONNA 100 pixels paired with GMRT depths.
  chs: [
    { depth: 1, color: "#c31300" },
    { depth: 10, color: "#c3c100" },
    { depth: 12, color: "#6bc300" },
    { depth: 15, color: "#00c200" },
    { depth: 22, color: "#04955f" },
    { depth: 26, color: "#068189" },
    { depth: 30, color: "#0965c2" },
    { depth: 40, color: "#0960bd" },
    { depth: 60, color: "#0551ad" },
    { depth: 100, color: "#003894" },
    { depth: 200, color: "#003290" },
    { depth: 400, color: "#002586" },
    { depth: 610, color: "#001a7d" },
    { depth: 870, color: "#000a72" },
    { depth: 1200, color: "#00006a" },
    { depth: 1750, color: "#000062" },
    { depth: 2450, color: "#00005b" },
    { depth: 3450, color: "#000052" },
    { depth: 4500, color: "#000045" },
  ],
};
export const defaultBathymetryPalette = "deep";

// Log-depth axis: both ramps change most over the first 30 m, which a linear
// axis would crush.
export const bathymetryScaleMin = 1;
export const bathymetryScaleMax = 5000;
export const bathymetryTicks = [1, 10, 100, 1000, 5000];

// Capped at a year: measured per uncached tile at z2-z5, 90 days ~7 KB / 11 ms,
// one year ~14 KB / 70 ms, all time ~380 KB / 1.8 s (100k+ line features).
export const defaultTrailingDays = 90;
export const trailingWindowOptions = [7, 14, 30, 90, 180, 365];
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
