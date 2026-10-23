const axios = require("axios");
const sharp = require("sharp");

// CHS NONNA's raw float elevations, read through its GeoServer WCS: the
// re-encoded tiles (routes/nonna.js) and the point depth (routes/depth.js).
// Metres, negative below chart datum.

const NONNA_WCS = "https://nonna-geoserver.data.chs-shc.ca/geoserver/wcs";

// Finest first: a pixel takes the first product that has a sounding there.
const COVERAGES = [
  { resolution: 10, id: "nonna__NONNA 10 Coverage", minZoom: 11 },
  { resolution: 100, id: "nonna__NONNA 100 Coverage", minZoom: 0 },
];

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

// The finest sounding under a point, as { elevation, resolution }, or null
// where CHS has none.
async function nonnaElevationAt(lon, lat) {
  const mx = (lon * WEB_MERCATOR_HALF) / 180;
  const my =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * WEB_MERCATOR_HALF) /
    Math.PI;
  const values = await Promise.all(
    COVERAGES.map(({ id }) =>
      fetchElevations(wcsUrl(id, [`X(${mx})`, `Y(${my})`])),
    ),
  );
  const i = values.findIndex((value) => isSounding(value[0]));
  return i === -1
    ? null
    : { elevation: values[i][0], resolution: COVERAGES[i].resolution };
}

module.exports = {
  COVERAGES,
  WEB_MERCATOR_HALF,
  fetchElevations,
  isSounding,
  nonnaElevationAt,
  wcsUrl,
};
