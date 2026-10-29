const axios = require("axios");
const sharp = require("sharp");
const { VectorTile } = require("@mapbox/vector-tile");
const Pbf = require("pbf");

const { WEB_MERCATOR_HALF, toWebMercator } = require("./nonnaWcs");

// Where NONNA may draw: OpenFreeMap's `water` polygons, the ones the
// basemap's coastline is drawn from. OSM's coastline follows high water, so
// drying flats stay in.

const OFM_TILEJSON = "https://tiles.openfreemap.org/planet";
// OFM's own maxzoom.
const POINT_ZOOM = 14;
const TILE_SIZE = 256;
const UPSTREAM_TIMEOUT_MS = 15000;
const POLYGON = 3;

// The tile URL carries OFM's release, so it comes from the TileJSON.
let tileUrlTemplate = null;

function ofmTileUrl() {
  if (!tileUrlTemplate) {
    tileUrlTemplate = axios
      .get(OFM_TILEJSON, { timeout: UPSTREAM_TIMEOUT_MS })
      .then(({ data }) => data.tiles[0])
      .catch((e) => {
        tileUrlTemplate = null;
        throw e;
      });
  }
  return tileUrlTemplate;
}

const ringPath = (ring) => `M${ring.map(({ x, y }) => `${x} ${y}`).join("L")}Z`;

// One path per feature: an ocean and a river polygon overlapping in one
// even-odd path would cancel each other out.
function waterSvg(layer) {
  const paths = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== POLYGON) continue;
    paths.push(
      `<path fill-rule="evenodd" d="${feature.loadGeometry().map(ringPath).join("")}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${layer.extent} ${layer.extent}">${paths.join("")}</svg>`;
}

// 256x256, 1 where the tile's pixel is water.
async function waterMask(z, x, y) {
  const url = (await ofmTileUrl())
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y);
  const { data } = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: UPSTREAM_TIMEOUT_MS,
  });
  const layer = new VectorTile(new Pbf(Buffer.from(data))).layers.water;
  if (!layer) return new Uint8Array(TILE_SIZE * TILE_SIZE);
  const alpha = await sharp(Buffer.from(waterSvg(layer)))
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
  return Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0));
}

async function isWaterAt(lon, lat) {
  const [mx, my] = toWebMercator(lon, lat);
  const tiles = 2 ** POINT_ZOOM;
  const fx = ((mx + WEB_MERCATOR_HALF) / (2 * WEB_MERCATOR_HALF)) * tiles;
  const fy = ((WEB_MERCATOR_HALF - my) / (2 * WEB_MERCATOR_HALF)) * tiles;
  const tx = Math.min(tiles - 1, Math.floor(fx));
  const ty = Math.min(tiles - 1, Math.floor(fy));
  const px = Math.min(TILE_SIZE - 1, Math.floor((fx - tx) * TILE_SIZE));
  const py = Math.min(TILE_SIZE - 1, Math.floor((fy - ty) * TILE_SIZE));
  const mask = await waterMask(POINT_ZOOM, tx, ty);
  return mask[py * TILE_SIZE + px] === 1;
}

module.exports = { isWaterAt, waterMask };
