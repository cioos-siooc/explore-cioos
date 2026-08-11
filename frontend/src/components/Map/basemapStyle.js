/*
 * Ocean-first basemap for the CDE map.
 *
 * Two base rasters that hand over to each other across z10–z12: a bathymetry
 * raster (EMODnet World Base Layer — global GEBCO-derived depth shading with
 * muted grey land) for the world view, satellite imagery (Esri World Imagery)
 * for the local view. Under them sits a slim OpenMapTiles-schema vector overlay
 * (OpenFreeMap) contributing rivers and streams, boundaries, and FR/EN water &
 * place labels.
 *
 * The drawn cartography that existed to compensate for the blurred raster —
 * the CIOOS water tint and the coastline stroke — lifts off across the same
 * window. Both were answering "which side of this edge is water?", and once
 * the satellite is in, it answers that itself; leaving the stroke on would only
 * draw an OSM shoreline a few tens of metres beside the visible one.
 * No API keys; all endpoints are CORS-open.
 *
 * Data layers (hexes/points/trajectories/griddap/WMS) are inserted by Map.js
 * *below* FIRST_LABEL_LAYER_ID so labels always stay readable on top.
 */

import { server } from '../../config'

const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

const EMODNET_TILES =
  'https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png'

// Esri tile REST convention is {z}/{y}/{x} (y before x), unlike XYZ schemes.
const ESRI_IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// CHS NONNA bathymetry, through our own API rather than direct. CHS allowlists
// request origins exactly and 403s every other one — including the CORS
// preflight — and MapLibre always sends an Origin for cross-origin tiles, so
// the browser cannot fetch these itself. web-api/routes/nonna.js fetches them
// server-side (no Origin header) and re-serves them same-origin; the reasoning
// is written out there.
const NONNA_100_TILES = `${server}/nonna/100/{z}/{x}/{y}.png`
const NONNA_10_TILES = `${server}/nonna/10/{z}/{x}/{y}.png`

const CHS_ATTRIBUTION =
  'Bathymetry © <a href="https://www.charts.gc.ca/data-gestion/index-eng.html">Canadian Hydrographic Service</a> (NONNA)'

// Attribution for OpenFreeMap's OSM-derived vector data (coastline, rivers,
// boundaries, labels).
const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const LABEL_LAYER_IDS = ['label-waterway', 'label-water', 'label-place']
// Anchor for every data layer Map.js adds: insert *before* this id so data
// renders under the labels.
export const FIRST_LABEL_LAYER_ID = 'label-waterway'

// text-field expression per label layer. Water-body names are bilingual
// (both languages when they differ — oceans/seas read naturally that way);
// river and place names follow the interface language.
export function getLabelTextField (lang, layerId) {
  const primary = ['coalesce', ['get', `name:${lang}`], ['get', 'name']]
  if (layerId === 'label-water') {
    const other = lang === 'fr' ? 'en' : 'fr'
    return [
      'case',
      [
        'all',
        ['has', 'name:fr'],
        ['has', 'name:en'],
        ['!=', ['get', 'name:fr'], ['get', 'name:en']]
      ],
      ['concat', primary, '\n', ['get', `name:${other}`]],
      primary
    ]
  }
  return primary
}

// Water polygons whose outline reads as a shoreline. Docks and pools are
// building-scale artifacts that would only add noise at high zoom.
const SHORELINE_FILTER = [
  'match',
  ['get', 'class'],
  ['swimming_pool', 'dock'],
  false,
  true
]

export function buildBasemapStyle (lang = 'en') {
  const layers = [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#DCE8E5' }
    },
    // The two base rasters cross-fade over z10–z12: EMODnet owns the world
    // view, satellite owns the local view, and neither is blended into the
    // other once the hand-off is done.
    //
    // The hand-off sits there because that is where each source runs out or
    // starts. EMODnet is pre-rendered only to z12 — past it the shading is
    // overzoom, and its land was always a flat muted grey with no features in
    // it, so a harbour view showed where the water ended and nothing about what
    // it ended against. Esri's imagery is the opposite: nothing useful at world
    // scale, everything from z12 in.
    {
      id: 'bathymetry',
      type: 'raster',
      source: 'bathymetry',
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 10, 1, 12, 0],
        'raster-saturation': -0.15
      }
    },
    // minzoom is what stops imagery tiles being fetched at low zoom; the
    // opacity ramp starting at 0 on that same zoom means they are already warm
    // by the time they become visible.
    {
      id: 'imagery',
      type: 'raster',
      source: 'imagery',
      minzoom: 10,
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 1],
        // Matches the bathymetry's muting so full-colour imagery doesn't shout
        // against the pastel palette everything else in the style shares.
        'raster-saturation': -0.15
      }
    },
    // Depth, back on top of the satellite. NONNA is transparent over land and
    // anywhere CHS holds no soundings, so unlike the EMODnet raster it can be
    // laid straight over the imagery without needing to be clipped to water —
    // which MapLibre cannot do for a raster anyway. That is what makes the
    // ocean readable at zooms where EMODnet has already faded out.
    //
    // Two products stacked best-resolution-last: NONNA 100 (100 m) is the broad
    // one, NONNA 10 (10 m) draws over it and wins wherever it has data — sharp
    // enough at z16 to show wharves and dredged channels. Both fade in together
    // so the pair always shows the finest soundings available for a spot rather
    // than holding the good ones back to an arbitrary zoom.
    //
    // Stacking them costs nothing visually even though both are translucent:
    // they share one colour ramp, so where 10 m covers 100 m it is the same
    // depth painted the same colour, and the blend just smooths the 100 m
    // blockiness. Where 10 m has no soundings its tile is transparent there and
    // the 100 m simply shows through. It does mean two tile requests per view,
    // which is what the proxy's in-process cache is sized for.
    //
    // The rainbow ramp is CHS's own, baked into the tiles: the layer is
    // published as pre-rendered RGB rather than raw depths, so an SLD colour
    // map cannot restyle it server-side. Opacity is the tuning knob for now.
    {
      id: 'bathymetry-nonna-100',
      type: 'raster',
      source: 'nonna100',
      minzoom: 10,
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 0.7]
      }
    },
    {
      id: 'bathymetry-nonna-10',
      type: 'raster',
      source: 'nonna10',
      minzoom: 10,
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 0.7]
      }
    },
    // Pulls the sea toward CIOOS teal and unifies the raster palette while
    // EMODnet is the base. It used to deepen with zoom, to keep a cue about
    // which side of the shore was water once the overzoomed raster washed out;
    // the satellite answers that question on its own, so the tint now lifts off
    // over the same window the imagery arrives in and leaves the water reading
    // as it actually looks.
    {
      id: 'water-tint',
      type: 'fill',
      source: 'ofm',
      'source-layer': 'water',
      paint: {
        'fill-color': '#52A79B',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.1, 13, 0]
      }
    },
    // Coastline, for the zooms EMODnet owns. Its land/sea edge is a soft
    // grey-to-blue gradient rather than a drawn line, and it reads worst in
    // fjords, inlets and archipelagos where the grey land and the shallow-shelf
    // blue sit at nearly the same value. These two vector lines (OSM water
    // polygons, crisp at any zoom because vector tiles overzoom losslessly)
    // draw that edge on top of the raster: a pale casing for contrast against
    // dark water, and a dark line for contrast against land.
    //
    // Both fade out by z12. They were the answer to a blurred raster shore, and
    // past z12 there is no raster shore left to fix — the satellite has its own,
    // and a drawn line beside it would only be a second, wrong one.
    {
      id: 'coastline-casing',
      type: 'line',
      source: 'ofm',
      'source-layer': 'water',
      filter: SHORELINE_FILTER,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#F3F0EC',
        // Off by z12, with the imagery fully in — see the coastline layer below.
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          0,
          7,
          0.35,
          10,
          0.5,
          12,
          0
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          1.2,
          10,
          2.4,
          14,
          3,
          18,
          3.6
        ]
      }
    },
    {
      id: 'coastline',
      type: 'line',
      source: 'ofm',
      'source-layer': 'water',
      filter: SHORELINE_FILTER,
      layout: { 'line-join': 'round' },
      paint: {
        // Slate-teal rather than near-black: dark enough to hold the edge
        // against pale land, but it sits in the basemap's own hue range
        // instead of reading as ink drawn over the top of it.
        'line-color': '#33555F',
        // Lifts off as the imagery arrives. This stroke exists because the
        // overzoomed EMODnet shore blurred away; the satellite draws its own
        // shore, and the OSM polygon it follows can sit tens of metres off the
        // visible waterline at z15+, so keeping it would add a second, wrong
        // coastline next to the real one.
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          0.3,
          6,
          0.55,
          10,
          0.72,
          12,
          0
        ],
        // Width still ramps for the zooms where the line is visible at all.
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          0.4,
          6,
          0.8,
          10,
          1.2,
          14,
          1.5,
          18,
          1.8
        ]
      }
    },
    // Watercourse centrelines — rivers, canals, and the streams/drains/ditches
    // below them — are a z12+ detail only.
    //
    // OSM carries a river centreline right through wide estuaries: the
    // Saint-Laurent is a single waterway=river all the way from the Great
    // Lakes out to the gulf, so it drew a solid line down the middle of 30 km
    // of open water at every zoom from 3 up. The tiles expose no flag for "this
    // line runs inside a water polygon" (class, brunnel, intermittent and name
    // are the only fields), so there is nothing to filter on — but any river
    // wide enough to look wrong as a line is already mapped as a water polygon,
    // which the coastline layer above outlines. Gating the centrelines to the
    // zooms where you are looking at local land detail keeps them where they
    // are the only representation of a watercourse and drops them where the
    // polygon has it covered.
    //
    // Streams stay a separate layer, under the rivers: they only exist in the
    // tiles from z12 anyway, and they want a thinner, lighter line.
    {
      id: 'waterway-stream',
      type: 'line',
      source: 'ofm',
      'source-layer': 'waterway',
      minzoom: 12,
      filter: [
        'match',
        ['get', 'class'],
        ['stream', 'drain', 'ditch'],
        true,
        false
      ],
      paint: {
        'line-color': '#3C8377',
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          0.35,
          14,
          0.5
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          0.5,
          14,
          1,
          18,
          2
        ]
      }
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'ofm',
      'source-layer': 'waterway',
      minzoom: 12,
      filter: [
        'match',
        ['get', 'class'],
        ['river', 'canal'],
        true,
        false
      ],
      paint: {
        'line-color': '#3C8377',
        'line-opacity': 0.6,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          1,
          14,
          1.6,
          18,
          2.6
        ]
      }
    },
    {
      id: 'boundary',
      type: 'line',
      source: 'ofm',
      'source-layer': 'boundary',
      // Land boundaries only. The maritime halves of the same borders run
      // clean across open water — the provincial lines through the Gulf of
      // St Lawrence and Cabot Strait — which is noise on an ocean map. The
      // tiles flag them, so unlike the river centrelines these can just be
      // filtered out. `maritime` is absent on plenty of features, and a
      // missing property compares unequal here, so those still draw.
      filter: [
        'all',
        ['<=', ['get', 'admin_level'], 4],
        ['!=', ['get', 'maritime'], 1]
      ],
      paint: {
        'line-color': 'rgba(21, 47, 55, 0.3)',
        'line-width': 1,
        'line-dasharray': [3, 2]
      }
    },
    {
      id: 'label-waterway',
      type: 'symbol',
      source: 'ofm',
      'source-layer': 'waterway',
      // Matches the centreline it is placed along: without this the estuary
      // still reads "Saint Lawrence River" across open water on an invisible
      // line. Big water bodies keep their name via label-water regardless.
      minzoom: 12,
      filter: ['match', ['get', 'class'], ['river', 'canal'], true, false],
      layout: {
        'symbol-placement': 'line',
        'text-field': getLabelTextField(lang, 'label-waterway'),
        'text-font': ['Noto Sans Italic'],
        'text-size': 11
      },
      paint: {
        'text-color': '#0F6D8E',
        'text-halo-color': '#F3F0EC',
        'text-halo-width': 1.2
      }
    },
    {
      id: 'label-water',
      type: 'symbol',
      source: 'ofm',
      'source-layer': 'water_name',
      layout: {
        'text-field': getLabelTextField(lang, 'label-water'),
        'text-font': ['Noto Sans Italic'],
        'text-size': [
          'match',
          ['get', 'class'],
          'ocean',
          16,
          'sea',
          13,
          11
        ],
        'text-letter-spacing': 0.1,
        'text-max-width': 6
      },
      paint: {
        'text-color': '#0F6D8E',
        'text-halo-color': '#F3F0EC',
        'text-halo-width': 1.5
      }
    },
    {
      id: 'label-place',
      type: 'symbol',
      source: 'ofm',
      'source-layer': 'place',
      filter: [
        'match',
        ['get', 'class'],
        ['country', 'state', 'city', 'town'],
        true,
        false
      ],
      layout: {
        'text-field': getLabelTextField(lang, 'label-place'),
        'text-font': ['Noto Sans Regular'],
        'text-size': [
          'match',
          ['get', 'class'],
          'country',
          14,
          'state',
          12,
          'city',
          12,
          10
        ],
        'text-transform': [
          'match',
          ['get', 'class'],
          'country',
          'uppercase',
          'none'
        ]
      },
      paint: {
        'text-color': '#152F37',
        'text-halo-color': '#F3F0EC',
        'text-halo-width': 1.2
      }
    }
  ]

  return {
    version: 8,
    glyphs: OFM_GLYPHS,
    sources: {
      bathymetry: {
        type: 'raster',
        tiles: [EMODNET_TILES],
        tileSize: 256,
        // pre-rendered up to z12; overzoom covers deeper levels
        maxzoom: 12,
        attribution:
          '© <a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry Consortium</a>'
      },
      imagery: {
        type: 'raster',
        tiles: [ESRI_IMAGERY_TILES],
        tileSize: 256,
        // Declared to z23, but only actually cached that deep in populated
        // areas: Halifax has imagery to z19, Ellesmere Island only to z17.
        // Past its coverage the service doesn't 404 — it serves a grey "map
        // data not yet available" tile, which would land on exactly the remote
        // Arctic shorelines where imagery is most wanted. Cap at the level that
        // exists everywhere and let MapLibre overzoom: soft, but never broken.
        // z17 is ~0.8 m/px at 45°N and ~0.4 m/px at 70°N.
        maxzoom: 17,
        attribution:
          'Imagery © <a href="https://www.esri.com">Esri</a>, Vantor, Earthstar Geographics'
      },
      // maxzoom 17 matches the camera cap; both products are served through the
      // proxy, which answers a transparent tile wherever CHS has nothing.
      nonna100: {
        type: 'raster',
        tiles: [NONNA_100_TILES],
        tileSize: 256,
        maxzoom: 17,
        attribution: CHS_ATTRIBUTION
      },
      nonna10: {
        type: 'raster',
        tiles: [NONNA_10_TILES],
        tileSize: 256,
        maxzoom: 17
      },
      ofm: {
        type: 'vector',
        url: OFM_TILEJSON,
        attribution:
          OSM_ATTRIBUTION +
          ', <a href="https://openfreemap.org">OpenFreeMap</a>'
      }
    },
    layers
  }
}
