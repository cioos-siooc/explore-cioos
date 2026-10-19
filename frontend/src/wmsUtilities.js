// ERDDAP's WMS serves EPSG:4326 only and MapLibre raster tiles need 3857, so
// the overlay is one viewport-sized `image` source warped to Mercator per
// moveend; unwarped, Canadian latitudes land 1-2 degrees off at low zoom.

import { server } from "./config";

// EPSG:3857 blows up at the poles; MapLibre clamps rendering there too.
const MAX_MERCATOR_LAT = 85.05;

export function clampBoundsForWms(bounds) {
  return {
    west: Math.max(bounds.getWest(), -180),
    south: Math.max(bounds.getSouth(), -MAX_MERCATOR_LAT),
    east: Math.min(bounds.getEast(), 180),
    north: Math.min(bounds.getNorth(), MAX_MERCATOR_LAT),
  };
}

// ERDDAP is strict about TIME format; grid_dimensions carries '+00:00'
// offsets from the harvester's isoformat().
function normalizeIsoTime(time) {
  return typeof time === "string" ? time.replace("+00:00", "Z") : time;
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
  elevation,
}) {
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.1.0",
    request: "GetMap",
    layers: `${datasetId}:${variable}`,
    styles: "",
    format: "image/png",
    transparent: "TRUE",
    srs: "EPSG:4326",
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    width: Math.round(width),
    height: Math.round(height),
  });
  if (time) params.set("time", normalizeIsoTime(time));
  if (elevation !== undefined && elevation !== null) {
    params.set("elevation", elevation);
  }
  return `${wmsUrl}?${params.toString()}`;
}

// ERDDAP draws legend text at a fixed size whatever the width, so the card
// sizes itself to the image rather than scaling it.
export const GRIDDAP_LEGEND_WIDTH = 360;

// ERDDAP's WMS has no GetLegendGraphic, so this uses griddap .png
// &.legend=Only, which must constrain every dimension in dataset order; lat/lon
// are strided to keep the read cheap. The drawn slice is named rather than
// `last` because ERDDAP prints the constraints into the legend's caption.
export function buildGriddapLegendUrl({
  erddapUrl,
  variable,
  dimensions,
  time,
  elevation,
}) {
  if (!erddapUrl || !variable) return null;
  const verticalDimension = getVerticalDimension(dimensions);
  const dimQuery = (dimensions || [])
    .map((dim) => {
      if (dim.name === "latitude" || dim.name === "longitude") {
        return "[0:10:last]";
      }
      if (dim.name === "time") {
        return time ? `[(${normalizeIsoTime(time)})]` : "[(last)]";
      }
      // Altitude back to the axis's own units: the negation is its own inverse.
      if (
        dim === verticalDimension &&
        elevation !== undefined &&
        elevation !== null
      ) {
        return `[(${toElevation(dim, elevation)})]`;
      }
      return "[0]";
    })
    .join("");
  const pngUrl = erddapUrl.replace(/\.html$/, ".png");
  return (
    `${pngUrl}?${encodeURIComponent(variable + dimQuery)}` +
    `&.legend=Only&.size=${GRIDDAP_LEGEND_WIDTH}|150`
  );
}

export function pickDefaultVariable(variables, selectedEovTitles) {
  const list = variables || [];
  const selected = selectedEovTitles || [];
  return (
    list.find((variable) =>
      (variable.eovs || []).some((eov) => selected.includes(eov)),
    ) ||
    list.find((variable) => (variable.eovs || []).length > 0) ||
    list[0]
  );
}

// `z` is the WMS ELEVATION, which is altitude, not depth.
export function wmsSliceParams(overlay) {
  const params = {};
  if (overlay.variable?.name) params.var = overlay.variable.name;
  if (overlay.time) params.date = overlay.time;
  if (overlay.elevation !== undefined && overlay.elevation !== null) {
    params.z = overlay.elevation;
  }
  return params;
}

export function wmsSliceFromParams(searchParams) {
  const slice = {};
  const variable = searchParams.get("var");
  const time = searchParams.get("date");
  const elevation = Number.parseFloat(searchParams.get("z"));
  if (variable) slice.variable = variable;
  // An unparseable time snaps to NaN and throws in toISOString(), crashing the card.
  if (time && Number.isFinite(Date.parse(time))) slice.time = time;
  if (Number.isFinite(elevation)) slice.elevation = elevation;
  return Object.keys(slice).length ? slice : undefined;
}

// Rolling grids move both ends of their time axis between harvests, so the
// harvested axis would be stale. Null on any failure (a static grid 404s) means
// keep the harvested dimensions.
export async function fetchGriddapTimeRange(datasetId) {
  if (!datasetId) return null;
  try {
    const response = await fetch(
      `${server}/griddapTimeRange?dataset=${encodeURIComponent(datasetId)}`,
    );
    if (!response.ok) return null;
    const time = await response.json();
    return time?.name === "time" ? time : null;
  } catch {
    return null;
  }
}

// Overlay descriptor only, never `dataset.grid_dimensions` (shown as harvested
// fact). n_values must move with the bounds: gridAxisNodes() derives its step
// from both, so updating one alone lands markers between slices.
export function withLiveTimeDimension(dimensions, liveTime) {
  const dims = dimensions || [];
  if (!liveTime) return dims;
  const index = dims.findIndex((dim) => dim.name === "time");
  if (index < 0) return dims;
  const merged = { ...dims[index] };
  for (const key of [
    "min",
    "max",
    "n_values",
    "spacing",
    "even_spacing",
    "units",
  ]) {
    if (liveTime[key] !== null && liveTime[key] !== undefined) {
      merged[key] = liveTime[key];
    }
  }
  const next = dims.slice();
  next[index] = merged;
  return next;
}

export function buildWmsOverlay(dataset, selectedEovTitles, slice, liveTime) {
  const dimensions = withLiveTimeDimension(dataset.grid_dimensions, liveTime);
  const variables = dataset.grid_variables || [];
  const timeDimension = getTimeDimension(dimensions);
  const named =
    slice?.variable &&
    variables.find((variable) => variable.name === slice.variable);
  return {
    pk: dataset.pk,
    datasetId: dataset.dataset_id,
    title: dataset.title,
    wmsUrl: dataset.wms_url,
    erddapUrl: dataset.erddap_url,
    variable: named || pickDefaultVariable(variables, selectedEovTitles),
    variables,
    time: slice?.time || timeDimension?.max,
    elevation: slice?.elevation ?? defaultElevation(dimensions),
    bbox: dataset.coverage_bbox_geojson,
    dimensions,
  };
}

// Null when the filter lies outside the viewport.
export function intersectBoundsWithPolygonBbox(bounds, polygonRing) {
  if (!polygonRing || polygonRing.length < 4) return bounds;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of polygonRing) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const clipped = {
    west: Math.max(bounds.west, west),
    south: Math.max(bounds.south, south),
    east: Math.min(bounds.east, east),
    north: Math.min(bounds.north, north),
  };
  if (clipped.west >= clipped.east || clipped.south >= clipped.north) {
    return null;
  }
  return clipped;
}

function mercatorY(latDeg) {
  const lat = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

// One 1-px-high drawImage per output row: a few ms for a viewport-sized image.
export function warpEquirectToMercator(
  img,
  latMinDeg,
  latMaxDeg,
  outWidth,
  outHeight,
) {
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");

  const mercTop = mercatorY(latMaxDeg);
  const mercBottom = mercatorY(latMinDeg);
  const latSpan = latMaxDeg - latMinDeg;

  for (let y = 0; y < outHeight; y++) {
    const merc = mercTop + ((y + 0.5) / outHeight) * (mercBottom - mercTop);
    const lat = ((2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180) / Math.PI;
    const srcY = ((latMaxDeg - lat) / latSpan) * img.height;
    ctx.drawImage(
      img,
      0,
      Math.min(Math.max(srcY - 0.5, 0), img.height - 1),
      img.width,
      1,
      0,
      y,
      outWidth,
      1,
    );
  }
  return canvas;
}

export function getTimeDimension(dimensions) {
  return (dimensions || []).find((dim) => dim.name === "time");
}

// ERDDAP axes are evenly spaced, so nodes rebuild from endpoints and count.
export function gridAxisNodes(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  if (!count || count < 2) return null;
  return { min, max, count, step: (max - min) / (count - 1) };
}

export function snapToGridNode(nodes, value) {
  if (!nodes) return value;
  const snapped =
    nodes.min + Math.round((value - nodes.min) / nodes.step) * nodes.step;
  return Math.min(Math.max(snapped, nodes.min), nodes.max);
}

export function getVerticalDimension(dimensions) {
  return (dimensions || []).find(
    (dim) => dim.name === "depth" || dim.name === "altitude",
  );
}

// ERDDAP WMS ELEVATION values are altitude (negative down).
export function toElevation(verticalDimension, value) {
  return verticalDimension.name === "depth" ? -value : value;
}

// The endpoint nearest the surface.
export function defaultElevation(dimensions) {
  const verticalDim = getVerticalDimension(dimensions);
  if (
    !verticalDim ||
    verticalDim.min === null ||
    verticalDim.min === undefined
  ) {
    return undefined;
  }
  const candidates = [
    toElevation(verticalDim, verticalDim.min),
    toElevation(verticalDim, verticalDim.max),
  ];
  return candidates.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b));
}

// "184×80" (longitude × latitude nodes)
export function formatGridSize(dimensions) {
  const lon = (dimensions || []).find((dim) => dim.name === "longitude");
  const lat = (dimensions || []).find((dim) => dim.name === "latitude");
  if (!lon?.n_values || !lat?.n_values) return null;
  return `${lon.n_values}×${lat.n_values}`;
}

const GRID_NODE_DIMENSION_ORDER = [
  "longitude",
  "latitude",
  "time",
  "depth",
  "altitude",
];

export function gridNodeFactors(dimensions) {
  const rank = (name) => {
    const index = GRID_NODE_DIMENSION_ORDER.indexOf(name);
    return index === -1 ? GRID_NODE_DIMENSION_ORDER.length : index;
  };
  return (dimensions || [])
    .filter((dim) => dim.n_values)
    .sort((a, b) => rank(a.name) - rank(b.name));
}

export function totalGridNodes(dimensions) {
  if (!dimensions || !dimensions.length) return null;
  return dimensions.reduce((total, dim) => total * (dim.n_values || 1), 1);
}
