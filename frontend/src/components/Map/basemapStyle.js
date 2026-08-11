/*
 * Ocean-first basemap for the CDE map.
 *
 * Stack: a bathymetry raster (EMODnet World Base Layer — global GEBCO-derived
 * depth shading with muted grey land) under a slim OpenMapTiles-schema vector
 * overlay (OpenFreeMap) that contributes the CIOOS water tint, a drawn
 * coastline, rivers and streams, boundaries, and FR/EN water & place labels.
 * No API keys; all endpoints are CORS-open.
 *
 * Data layers (hexes/points/trajectories/griddap/WMS) are inserted by Map.js
 * *below* FIRST_LABEL_LAYER_ID so labels always stay readable on top.
 */

const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

const EMODNET_TILES =
  'https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png'

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
    {
      id: 'bathymetry',
      type: 'raster',
      source: 'bathymetry',
      paint: { 'raster-saturation': -0.15 }
    },
    // Pulls the sea toward CIOOS teal and unifies the raster palette. The tint
    // deepens past z12: that's where the raster stops carrying real detail and
    // washes out to near-white on both sides of the shore, so without it a
    // harbour view gives no cue which side of the coastline is water. Stays
    // light at low zoom, where the bathymetry shading does that job itself.
    {
      id: 'water-tint',
      type: 'fill',
      source: 'ofm',
      'source-layer': 'water',
      paint: {
        'fill-color': '#52A79B',
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.1,
          13,
          0.16,
          16,
          0.24
        ]
      }
    },
    // Coastline. The EMODnet raster is pre-rendered only to z12 and its
    // land/sea edge is a soft grey-to-blue gradient, so past z12 the overzoomed
    // shoreline blurs away — worst in fjords, inlets and archipelagos where the
    // grey land and the shallow-shelf blue are nearly the same value. These two
    // vector lines (OSM water polygons, crisp at any zoom because vector tiles
    // overzoom losslessly) redraw that edge on top of the raster: a pale casing
    // for contrast against dark water, and a dark line for contrast against
    // land. Width ramps with zoom so the world view stays a hairline while a
    // harbour view gets a definite edge.
    {
      id: 'coastline-casing',
      type: 'line',
      source: 'ofm',
      'source-layer': 'water',
      filter: SHORELINE_FILTER,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#F3F0EC',
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          0,
          7,
          0.35,
          11,
          0.5
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          1.2,
          10,
          3,
          14,
          5,
          18,
          7
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
          14,
          0.82
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          0.4,
          6,
          0.8,
          10,
          1.4,
          14,
          2.2,
          18,
          3
        ]
      }
    },
    // Streams (and the drains/ditches OSM lumps with them) are their own layer
    // below the rivers rather than another class in the filter below: they only
    // exist in the tiles from z12, they are dense enough to read as noise at
    // any wider view, and they want a thinner, lighter line than a river gets.
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
          6,
          0.6,
          10,
          1.6,
          14,
          3
        ]
      }
    },
    {
      id: 'boundary',
      type: 'line',
      source: 'ofm',
      'source-layer': 'boundary',
      filter: ['<=', ['get', 'admin_level'], 4],
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
      minzoom: 6,
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
