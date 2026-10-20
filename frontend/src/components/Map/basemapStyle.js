/*
 * Ocean-first basemap: EMODnet bathymetry for the world view handing over to
 * Esri imagery at z10, under an OpenFreeMap vector overlay (rivers,
 * boundaries, FR/EN labels). No API keys.
 *
 * Map.jsx inserts data layers below FIRST_LABEL_LAYER_ID so labels stay on top.
 */

import { server } from "../../config";
import {
  basemapHandoffEndZoom,
  basemapHandoffStartZoom,
  basemapPrewarmZoom,
  bathymetryFadeInZoom,
  bathymetryFullZoom,
} from "../config.js";

const OFM_TILEJSON = "https://tiles.openfreemap.org/planet";
const OFM_GLYPHS =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

// Re-encoded as WebP and cached by web-api/routes/emodnet.js: upstream's PNGs
// were the slowest tiles on the map.
const EMODNET_TILES = `${server}/emodnet/{z}/{x}/{y}.webp`;

// Esri tile REST convention is {z}/{y}/{x} (y before x), unlike XYZ schemes.
const ESRI_IMAGERY_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// CHS allowlists request origins exactly (403ing the CORS preflight too), and
// MapLibre always sends an Origin, so these go through web-api/routes/nonna.js.
const NONNA_100_TILES = `${server}/nonna/100/{z}/{x}/{y}.png`;
const NONNA_10_TILES = `${server}/nonna/10/{z}/{x}/{y}.png`;

const CHS_ATTRIBUTION =
  'Bathymetry © <a href="https://www.charts.gc.ca/data-gestion/index-eng.html">Canadian Hydrographic Service</a> (NONNA)';

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const LABEL_LAYER_IDS = [
  "label-waterway",
  "label-water",
  "label-water-line",
  "label-place",
];
// Anchor for every data layer Map.js adds: insert *before* this id so data
// renders under the labels.
export const FIRST_LABEL_LAYER_ID = "label-waterway";

export function getLabelTextField(lang) {
  return ["coalesce", ["get", `name:${lang}`], ["get", "name"]];
}

// Water polygons whose outline reads as a shoreline. Docks and pools are
// building-scale artifacts that would only add noise at high zoom.
const SHORELINE_FILTER = [
  "match",
  ["get", "class"],
  ["swimming_pool", "dock"],
  false,
  true,
];

// Shared by label-water and label-water-line so a water body labels alike
// whichever geometry it is stored as. Lakes get a larger bold tier to read as
// freshwater without a colour change.
const WATER_LABEL_TEXT_SIZE = [
  "match",
  ["get", "class"],
  "ocean",
  16,
  "sea",
  13,
  "lake",
  13,
  11,
];
const WATER_LABEL_TEXT_FONT = [
  "match",
  ["get", "class"],
  "lake",
  ["literal", ["Noto Sans Bold"]],
  ["literal", ["Noto Sans Italic"]],
];
const WATER_LABEL_PAINT = {
  "text-color": "#0F6D8E",
  "text-halo-color": "#F3F0EC",
  "text-halo-width": 1.5,
};

export function buildBasemapStyle(lang = "en") {
  const layers = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#DCE8E5" },
    },
    // The rasters swap over the half zoom below z10: EMODnet is pre-rendered
    // only to z12 with featureless land, and imagery is useless at world scale.
    // A long cross-fade would leave a band of two half-opaque rasters with
    // NONNA unreadable on top.
    //
    // Every layer that fades to nothing carries a matching maxzoom: MapLibre
    // skips drawing a zero-opacity layer but still fetches, parses and
    // tessellates it unless minzoom/maxzoom/visibility exclude it.
    {
      id: "bathymetry",
      type: "raster",
      source: "bathymetry",
      // Also stops EMODnet tiles being fetched and cached past the hand-off: a
      // layer outside its zoom range marks its source unused.
      maxzoom: basemapHandoffEndZoom,
      paint: {
        "raster-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          basemapHandoffStartZoom,
          1,
          basemapHandoffEndZoom,
          0,
        ],
        "raster-saturation": -0.15,
      },
    },
    // Esri tiles arrive far slower than this vector line, so on a pan to a
    // fresh area it shows through the gap until the imagery paints over it.
    {
      id: "coastline-satellite-underlay",
      type: "line",
      source: "ofm",
      "source-layer": "water",
      filter: SHORELINE_FILTER,
      minzoom: basemapHandoffStartZoom,
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#33555F",
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          basemapHandoffStartZoom,
          0,
          basemapHandoffEndZoom,
          0.6,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 2],
      },
    },
    // Mounted half a zoom before the fade so its tiles, requested then, land
    // before the short hand-off is over.
    {
      id: "imagery",
      type: "raster",
      source: "imagery",
      minzoom: basemapPrewarmZoom,
      paint: {
        "raster-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          basemapHandoffStartZoom,
          0,
          basemapHandoffEndZoom,
          1,
        ],
        // Matches the bathymetry's muting so full-colour imagery doesn't shout
        // against the pastel palette everything else in the style shares.
        "raster-saturation": -0.15,
      },
    },
    // NONNA is transparent over land and where CHS has no soundings, so it can
    // lie straight over the imagery (MapLibre can't clip a raster to water).
    // NONNA 10 draws over NONNA 100; they share one colour ramp, so the stack
    // only smooths the 100 m blockiness. The ramp is baked into CHS's tiles,
    // which is why the legend's depth axis is calibrated from them
    // (bathymetryColorScale in config.js).
    {
      id: "bathymetry-nonna-100",
      type: "raster",
      source: "nonna100",
      // Mounted early like the imagery: these come through our proxy and are
      // the slowest tiles on the map on a cold cache.
      minzoom: basemapPrewarmZoom,
      paint: {
        "raster-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          bathymetryFadeInZoom,
          0,
          bathymetryFullZoom,
          0.7,
        ],
        // The default 300 ms cross-fade draws both tiles, and these translucent
        // layers over the satellite are the most overdrawn part of the map;
        // fading instantly also releases the parent tiles sooner.
        "raster-fade-duration": 0,
      },
    },
    {
      id: "bathymetry-nonna-10",
      type: "raster",
      source: "nonna10",
      minzoom: basemapPrewarmZoom,
      paint: {
        "raster-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          bathymetryFadeInZoom,
          0,
          bathymetryFullZoom,
          0.7,
        ],
        "raster-fade-duration": 0,
      },
    },
    // Pulls the sea toward CIOOS teal while EMODnet is the base; lifts off as
    // the imagery arrives.
    {
      id: "water-tint",
      type: "fill",
      source: "ofm",
      "source-layer": "water",
      maxzoom: basemapHandoffEndZoom,
      paint: {
        "fill-color": "#52A79B",
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          basemapHandoffStartZoom,
          0.1,
          basemapHandoffEndZoom,
          0,
        ],
      },
    },
    // EMODnet's land/sea edge is a soft gradient that vanishes in fjords and
    // archipelagos, so these vector lines draw it: a pale casing against dark
    // water, a dark line against land. They fade out with the raster by z10,
    // and are the most expensive geometry here (water polygons as lines,
    // twice), hence the maxzoom.
    {
      id: "coastline-casing",
      type: "line",
      source: "ofm",
      "source-layer": "water",
      filter: SHORELINE_FILTER,
      maxzoom: basemapHandoffEndZoom,
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#F3F0EC",
        // Off by z10, with the imagery fully in — see the coastline layer
        // below.
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          0,
          7,
          0.35,
          basemapHandoffStartZoom,
          0.5,
          basemapHandoffEndZoom,
          0,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 10, 2.4],
      },
    },
    {
      id: "coastline",
      type: "line",
      source: "ofm",
      "source-layer": "water",
      filter: SHORELINE_FILTER,
      maxzoom: basemapHandoffEndZoom,
      layout: { "line-join": "round" },
      paint: {
        // Slate-teal rather than near-black: dark enough to hold the edge
        // against pale land, but it sits in the basemap's own hue range
        // instead of reading as ink drawn over the top of it.
        "line-color": "#33555F",
        // Lifts off as the imagery arrives: the OSM polygon can sit tens of
        // metres off the visible waterline at z15+.
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          2,
          0.3,
          6,
          0.55,
          basemapHandoffStartZoom,
          0.72,
          basemapHandoffEndZoom,
          0,
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          2,
          0.4,
          6,
          0.8,
          10,
          1.2,
        ],
      },
    },
    // Centrelines are z12+ only: OSM runs a river line down wide estuaries (the
    // Saint-Laurent through 30 km of open water) with no field to filter on,
    // and any river wide enough to look wrong is already a water polygon.
    // Streams stay a separate, thinner layer under the rivers.
    {
      id: "waterway-stream",
      type: "line",
      source: "ofm",
      "source-layer": "waterway",
      minzoom: 12,
      filter: [
        "match",
        ["get", "class"],
        ["stream", "drain", "ditch"],
        true,
        false,
      ],
      paint: {
        "line-color": "#3C8377",
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          0.35,
          14,
          0.5,
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          0.5,
          14,
          1,
          18,
          2,
        ],
      },
    },
    {
      id: "waterway",
      type: "line",
      source: "ofm",
      "source-layer": "waterway",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["river", "canal"], true, false],
      paint: {
        "line-color": "#3C8377",
        "line-opacity": 0.6,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          1,
          14,
          1.6,
          18,
          2.6,
        ],
      },
    },
    {
      id: "boundary",
      type: "line",
      source: "ofm",
      "source-layer": "boundary",
      // Land boundaries only: maritime borders across the Gulf are noise. A
      // missing `maritime` compares unequal, so those features still draw.
      filter: [
        "all",
        ["<=", ["get", "admin_level"], 4],
        ["!=", ["get", "maritime"], 1],
      ],
      paint: {
        "line-color": "rgba(21, 47, 55, 0.3)",
        "line-width": 1,
        "line-dasharray": [3, 2],
      },
    },
    {
      id: "label-waterway",
      type: "symbol",
      source: "ofm",
      "source-layer": "waterway",
      // Matches the centreline it is placed along: without this the estuary
      // still reads "Saint Lawrence River" across open water on an invisible
      // line. Big water bodies keep their name via label-water regardless.
      minzoom: 12,
      filter: ["match", ["get", "class"], ["river", "canal"], true, false],
      layout: {
        "symbol-placement": "line",
        "text-field": getLabelTextField(lang),
        "text-font": ["Noto Sans Italic"],
        "text-size": 11,
      },
      paint: {
        "text-color": "#0F6D8E",
        "text-halo-color": "#F3F0EC",
        "text-halo-width": 1.2,
      },
    },
    {
      // Point-geometry water bodies only; elongated ones are lines, handled by
      // label-water-line.
      id: "label-water",
      type: "symbol",
      source: "ofm",
      "source-layer": "water_name",
      filter: ["!=", ["geometry-type"], "LineString"],
      layout: {
        "text-field": getLabelTextField(lang),
        "text-font": WATER_LABEL_TEXT_FONT,
        "text-size": WATER_LABEL_TEXT_SIZE,
        "text-letter-spacing": 0.1,
        "text-max-width": 6,
        // OSM tags big bays as many same-named points (Hudson Bay has ~217);
        // padding this far lets collision drop all but one.
        "text-padding": 80,
      },
      paint: WATER_LABEL_PAINT,
    },
    {
      // 'viewport' rotation keeps the name upright and straight rather than
      // bent glyph-by-glyph along the line.
      id: "label-water-line",
      type: "symbol",
      source: "ofm",
      "source-layer": "water_name",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: {
        "symbol-placement": "line-center",
        "text-rotation-alignment": "viewport",
        "text-field": getLabelTextField(lang),
        "text-font": WATER_LABEL_TEXT_FONT,
        "text-size": WATER_LABEL_TEXT_SIZE,
        "text-letter-spacing": 0.1,
      },
      paint: WATER_LABEL_PAINT,
    },
    {
      id: "label-place",
      type: "symbol",
      source: "ofm",
      "source-layer": "place",
      filter: [
        "match",
        ["get", "class"],
        ["country", "state", "city", "town"],
        true,
        false,
      ],
      layout: {
        "text-field": getLabelTextField(lang),
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "match",
          ["get", "class"],
          "country",
          14,
          "state",
          12,
          "city",
          12,
          10,
        ],
        "text-transform": [
          "match",
          ["get", "class"],
          "country",
          "uppercase",
          "none",
        ],
      },
      paint: {
        "text-color": "#152F37",
        "text-halo-color": "#F3F0EC",
        "text-halo-width": 1.2,
      },
    },
  ];

  return {
    version: 8,
    glyphs: OFM_GLYPHS,
    sources: {
      bathymetry: {
        type: "raster",
        tiles: [EMODNET_TILES],
        tileSize: 256,
        // z10 tiles would only draw while the raster fades out (z9.5-10), yet
        // they are ~80% of the tiles over Canada that the proxy caches, so
        // that half zoom overzooms z9.
        maxzoom: 9,
        attribution:
          '© <a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry Consortium</a>',
      },
      imagery: {
        type: "raster",
        tiles: [ESRI_IMAGERY_TILES],
        tileSize: 256,
        // Declared to z23 but cached only to z17 in remote areas (Ellesmere
        // Island), past which it serves a grey "not yet available" tile rather
        // than a 404, so overzoom from the level that exists everywhere.
        maxzoom: 17,
        attribution:
          'Imagery © <a href="https://www.esri.com">Esri</a>, Vantor, Earthstar Geographics',
      },
      // The proxy answers a transparent tile wherever CHS has nothing. maxzoom
      // is where each grid runs out of soundings (100 m past ~z10, 10 m past
      // ~z13) plus 2x headroom: deeper levels were only upsampled server-side,
      // and capping cut z16 requests from ~60 per viewport to ~6.
      nonna100: {
        type: "raster",
        tiles: [NONNA_100_TILES],
        tileSize: 256,
        maxzoom: 11,
        attribution: CHS_ATTRIBUTION,
      },
      nonna10: {
        type: "raster",
        tiles: [NONNA_10_TILES],
        tileSize: 256,
        maxzoom: 14,
      },
      ofm: {
        type: "vector",
        url: OFM_TILEJSON,
        attribution:
          OSM_ATTRIBUTION +
          ', <a href="https://openfreemap.org">OpenFreeMap</a>',
      },
    },
    layers,
  };
}
