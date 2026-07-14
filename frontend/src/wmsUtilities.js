// Helpers for the griddap WMS overlay.
//
// ERDDAP's built-in WMS serves EPSG:4326 only, while MapLibre raster-tile
// sources require EPSG:3857 tiles. The overlay is therefore a single
// viewport-sized MapLibre `image` source: one WMS 1.1.0 GetMap per (debounced)
// moveend, warped from equirectangular to Mercator row-by-row on an offscreen
// canvas before it's handed to the map. Without the warp, features at
// Canadian latitudes land 1-2 degrees of latitude off at low zoom.

// EPSG:3857 blows up at the poles; MapLibre clamps rendering there too.
const MAX_MERCATOR_LAT = 85.05

export function clampBoundsForWms(bounds) {
  return {
    west: Math.max(bounds.getWest(), -180),
    south: Math.max(bounds.getSouth(), -MAX_MERCATOR_LAT),
    east: Math.min(bounds.getEast(), 180),
    north: Math.min(bounds.getNorth(), MAX_MERCATOR_LAT)
  }
}

// ERDDAP is strict about TIME format; grid_dimensions carries '+00:00'
// offsets from the harvester's isoformat().
function normalizeIsoTime(time) {
  return typeof time === 'string' ? time.replace('+00:00', 'Z') : time
}

// WMS 1.1.0 on purpose: SRS=EPSG:4326 with lon,lat bbox axis order. (1.3.0
// flips the axis order for EPSG:4326, a classic source of mirrored maps.)
export function buildWmsGetMapUrl({
  wmsUrl,
  datasetId,
  variable,
  bounds,
  width,
  height,
  time,
  elevation
}) {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.0',
    request: 'GetMap',
    layers: `${datasetId}:${variable}`,
    styles: '',
    format: 'image/png',
    transparent: 'TRUE',
    srs: 'EPSG:4326',
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    width: Math.round(width),
    height: Math.round(height)
  })
  if (time) params.set('time', normalizeIsoTime(time))
  if (elevation !== undefined && elevation !== null) {
    params.set('elevation', elevation)
  }
  return `${wmsUrl}?${params.toString()}`
}

// ERDDAP's WMS has no GetLegendGraphic; the griddap .png endpoint's
// &.legend=Only mode is the colorbar source. The query must constrain every
// dimension in dataset order: latest time slice, first level of any other
// non-spatial dimension, and strided lat/lon to keep the server-side read
// cheap (the legend only depends on the variable's palette + range).
export function buildGriddapLegendUrl({ erddapUrl, variable, dimensions }) {
  if (!erddapUrl || !variable) return null
  const dimQuery = (dimensions || [])
    .map((dim) => {
      if (dim.name === 'latitude' || dim.name === 'longitude') {
        return '[0:10:last]'
      }
      if (dim.name === 'time') return '[(last)]'
      return '[0]'
    })
    .join('')
  const pngUrl = erddapUrl.replace(/\.html$/, '.png')
  return `${pngUrl}?${encodeURIComponent(variable + dimQuery)}&.legend=Only`
}

// The WMS default: the first variable representing a currently-selected EOV,
// then the first representing any of the dataset's EOVs, then the first
// variable. `variable.eovs` is attached at harvest time (empty on datasets
// harvested before that change, so the final fallback keeps the overlay usable).
export function pickDefaultVariable(variables, selectedEovTitles) {
  const list = variables || []
  const selected = selectedEovTitles || []
  return (
    list.find((variable) =>
      (variable.eovs || []).some((eov) => selected.includes(eov))
    ) ||
    list.find((variable) => (variable.eovs || []).length > 0) ||
    list[0]
  )
}

// The griddap overlay descriptor consumed by the Map image source and the
// WmsLegend card. Shared by the auto-show-on-inspect effect and the manual
// "show on map" toggle so both default the variable the same way.
export function buildWmsOverlay(dataset, selectedEovTitles) {
  const dimensions = dataset.grid_dimensions || []
  const variables = dataset.grid_variables || []
  const timeDimension = getTimeDimension(dimensions)
  return {
    pk: dataset.pk,
    datasetId: dataset.dataset_id,
    title: dataset.title,
    wmsUrl: dataset.wms_url,
    erddapUrl: dataset.erddap_url,
    variable: pickDefaultVariable(variables, selectedEovTitles),
    variables,
    time: timeDimension?.max,
    elevation: defaultElevation(dimensions),
    bbox: dataset.coverage_bbox_geojson,
    dimensions
  }
}

// Clip the WMS request/display extent to the active spatial filter: the
// intersection of the current viewport bounds and the filter polygon's
// bounding box. Returns null when the filter lies outside the viewport (the
// caller skips the render). `polygonRing` is a [lng, lat][] ring, as stored by
// SelectionProvider.
export function intersectBoundsWithPolygonBbox(bounds, polygonRing) {
  if (!polygonRing || polygonRing.length < 4) return bounds
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lng, lat] of polygonRing) {
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  const clipped = {
    west: Math.max(bounds.west, west),
    south: Math.max(bounds.south, south),
    east: Math.min(bounds.east, east),
    north: Math.min(bounds.north, north)
  }
  if (clipped.west >= clipped.east || clipped.south >= clipped.north) {
    return null
  }
  return clipped
}

function mercatorY(latDeg) {
  const lat = (latDeg * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + lat / 2))
}

// Resample an equirectangular (EPSG:4326) GetMap image onto a Mercator grid:
// every destination row is uniform in Mercator Y, its latitude picks the
// source row (uniform in latitude). One 1-px-high drawImage per output row —
// a few ms for a viewport-sized image.
export function warpEquirectToMercator(img, latMinDeg, latMaxDeg, outWidth, outHeight) {
  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext('2d')

  const mercTop = mercatorY(latMaxDeg)
  const mercBottom = mercatorY(latMinDeg)
  const latSpan = latMaxDeg - latMinDeg

  for (let y = 0; y < outHeight; y++) {
    const merc = mercTop + ((y + 0.5) / outHeight) * (mercBottom - mercTop)
    const lat = ((2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180) / Math.PI
    const srcY = ((latMaxDeg - lat) / latSpan) * img.height
    ctx.drawImage(
      img,
      0, Math.min(Math.max(srcY - 0.5, 0), img.height - 1), img.width, 1,
      0, y, outWidth, 1
    )
  }
  return canvas
}

export function getTimeDimension(dimensions) {
  return (dimensions || []).find((dim) => dim.name === 'time')
}

export function getVerticalDimension(dimensions) {
  return (dimensions || []).find(
    (dim) => dim.name === 'depth' || dim.name === 'altitude'
  )
}

// ERDDAP WMS ELEVATION values are altitude (negative down).
export function toElevation(verticalDimension, value) {
  return verticalDimension.name === 'depth' ? -value : value
}

// Only the range endpoints are known from the harvested metadata; the default
// level is the endpoint nearest the surface. (ERDDAP snaps TIME/ELEVATION to
// the nearest grid node, so interpolated slider values are safe too.)
export function defaultElevation(dimensions) {
  const verticalDim = getVerticalDimension(dimensions)
  if (!verticalDim || verticalDim.min === null || verticalDim.min === undefined) {
    return undefined
  }
  const candidates = [
    toElevation(verticalDim, verticalDim.min),
    toElevation(verticalDim, verticalDim.max)
  ]
  return candidates.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b))
}

// "184×80" (longitude × latitude nodes)
export function formatGridSize(dimensions) {
  const lon = (dimensions || []).find((dim) => dim.name === 'longitude')
  const lat = (dimensions || []).find((dim) => dim.name === 'latitude')
  if (!lon?.n_values || !lat?.n_values) return null
  return `${lon.n_values}×${lat.n_values}`
}

// Node count broken down into its factors, e.g. longitude × latitude × time ×
// depth. Spatial axes lead (the order the count is usually quoted in); any
// dimension the grid doesn't have is simply absent.
const GRID_NODE_DIMENSION_ORDER = [
  'longitude',
  'latitude',
  'time',
  'depth',
  'altitude'
]

export function gridNodeFactors(dimensions) {
  const rank = (name) => {
    const index = GRID_NODE_DIMENSION_ORDER.indexOf(name)
    return index === -1 ? GRID_NODE_DIMENSION_ORDER.length : index
  }
  return (dimensions || [])
    .filter((dim) => dim.n_values)
    .sort((a, b) => rank(a.name) - rank(b.name))
}

export function totalGridNodes(dimensions) {
  if (!dimensions || !dimensions.length) return null
  return dimensions.reduce(
    (total, dim) => total * (dim.n_values || 1),
    1
  )
}
