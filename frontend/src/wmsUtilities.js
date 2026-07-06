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

// ERDDAP WMS ELEVATION values are altitude (negative down). Only the range
// endpoints are known from the harvested metadata; pick the one nearest the
// surface.
export function defaultElevation(dimensions) {
  const verticalDim = (dimensions || []).find(
    (dim) => dim.name === 'depth' || dim.name === 'altitude'
  )
  if (!verticalDim || verticalDim.min === null || verticalDim.min === undefined) {
    return undefined
  }
  const asElevation = (value) => (verticalDim.name === 'depth' ? -value : value)
  const candidates = [asElevation(verticalDim.min), asElevation(verticalDim.max)]
  return candidates.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b))
}

// "184×80" (longitude × latitude nodes)
export function formatGridSize(dimensions) {
  const lon = (dimensions || []).find((dim) => dim.name === 'longitude')
  const lat = (dimensions || []).find((dim) => dim.name === 'latitude')
  if (!lon?.n_values || !lat?.n_values) return null
  return `${lon.n_values}×${lat.n_values}`
}

export function totalGridNodes(dimensions) {
  if (!dimensions || !dimensions.length) return null
  return dimensions.reduce(
    (total, dim) => total * (dim.n_values || 1),
    1
  )
}
