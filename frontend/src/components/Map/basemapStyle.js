/*
 * Ocean-first basemap for the CDE map.
 *
 * Stack: a bathymetry raster (EMODnet World Base Layer — global GEBCO-derived
 * depth shading with muted grey land) under a slim OpenMapTiles-schema vector
 * overlay (OpenFreeMap) that contributes the CIOOS water tint, rivers,
 * boundaries, and FR/EN water & place labels. No API keys; all endpoints are
 * CORS-open. Fallbacks (see `basemap` in components/config.js): GEBCO WMS,
 * then plain OSM raster.
 *
 * Data layers (hexes/points/trajectories/griddap/WMS) are inserted by Map.js
 * *below* FIRST_LABEL_LAYER_ID so labels always stay readable on top.
 */

const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

const EMODNET_TILES =
  'https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png'
const GEBCO_WMS =
  'https://wms.gebco.net/mapserv?service=WMS&version=1.3.0&request=GetMap' +
  '&layers=gebco_latest&styles=&crs=EPSG:3857&format=image/png' +
  '&width=256&height=256&bbox={bbox-epsg-3857}'
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

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

function basemapSources (basemap) {
  switch (basemap) {
  case 'gebco':
    return {
      bathymetry: {
        type: 'raster',
        tiles: [GEBCO_WMS],
        tileSize: 256,
        attribution: 'Imagery reproduced from the GEBCO 2024 Grid'
      }
    }
  case 'osm':
    return {
      bathymetry: {
        type: 'raster',
        tiles: [OSM_TILES],
        tileSize: 256,
        attribution: OSM_ATTRIBUTION
      }
    }
  case 'emodnet':
  default:
    return {
      bathymetry: {
        type: 'raster',
        tiles: [EMODNET_TILES],
        tileSize: 256,
        // pre-rendered up to z12; overzoom covers deeper levels
        maxzoom: 12,
        attribution:
          '© <a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry Consortium</a>'
      }
    }
  }
}

export function buildBasemapStyle (lang = 'en', basemap = 'emodnet') {
  const isOsm = basemap === 'osm'

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
      paint: isOsm ? {} : { 'raster-saturation': -0.15 }
    },
    // Pull the sea toward CIOOS teal and unify the raster palette. Skipped
    // over OSM, which paints its own water color.
    ...(isOsm
      ? []
      : [
        {
          id: 'water-tint',
          type: 'fill',
          source: 'ofm',
          'source-layer': 'water',
          paint: {
            'fill-color': '#52A79B',
            'fill-opacity': 0.1
          }
        }
      ]),
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
      ...basemapSources(basemap),
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
