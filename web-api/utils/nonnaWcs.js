const axios = require("axios");
const sharp = require("sharp");

// CHS NONNA's raw float elevations, read through its GeoServer WCS: the
// re-encoded tiles (routes/nonna.js) and the point depth (routes/depth.js).
// Metres, negative below chart datum.

const NONNA_WCS = "https://nonna-geoserver.data.chs-shc.ca/geoserver/wcs";

const NONNA_10 = { resolution: 10, id: "nonna__NONNA 10 Coverage" };

// Float32 max; CHS's nodata.
const NODATA_ABOVE = 1e30;

const WEB_MERCATOR_HALF = 20037508.342789244;
const UPSTREAM_TIMEOUT_MS = 15000;

function wcsUrl(coverageId, subsets, extra = {}) {
  const params = new URLSearchParams({
    service: "WCS",
    version: "2.0.1",
    request: "GetCoverage",
    coverageId,
    format: "image/tiff",
    ...extra,
  });
  // Repeated keys, which axios's params serialiser would bracket.
  subsets.forEach((subset) => params.append("subset", subset));
  return `${NONNA_WCS}?${params}`;
}

async function fetchElevations(url) {
  const upstream = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: UPSTREAM_TIMEOUT_MS,
  });
  // sharp expands a one-band float TIFF to three identical bands.
  const { data } = await sharp(Buffer.from(upstream.data))
    .extractChannel(0)
    .raw({ depth: "float" })
    .toBuffer({ resolveWithObject: true });
  return new Float32Array(data.buffer, data.byteOffset, data.length / 4);
}

const isSounding = (v) => Number.isFinite(v) && v < NODATA_ABOVE;

const toWebMercator = (lon, lat) => [
  (lon * WEB_MERCATOR_HALF) / 180,
  (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * WEB_MERCATOR_HALF) /
    Math.PI,
];

// The NONNA 10 sounding under a point, as { elevation, resolution }, or null
// where CHS has none.
async function nonnaElevationAt(lon, lat) {
  const [mx, my] = toWebMercator(lon, lat);
  const [elevation] = await fetchElevations(
    wcsUrl(NONNA_10.id, [`X(${mx})`, `Y(${my})`]),
  );
  return isSounding(elevation)
    ? { elevation, resolution: NONNA_10.resolution }
    : null;
}

module.exports = {
  NONNA_10,
  WEB_MERCATOR_HALF,
  fetchElevations,
  isSounding,
  nonnaElevationAt,
  toWebMercator,
  wcsUrl,
};
