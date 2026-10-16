import turfBbox from "@turf/bbox";
import turfBboxPolygon from "@turf/bbox-polygon";
import { polygon as turfPolygon } from "@turf/helpers";
import turfSimplify from "@turf/simplify";

// NRCan's Canadian Geographical Names Database: bilingual, open to the browser
// (CORS *), and it returns each named area's outline with the hit.
export const GEONAMES_API = "https://geogratis.gc.ca/services/geoname";

// The feature types that name an area someone would filter ocean data by.
// The rest (towns, capes, mountains, roads…) are points or land.
export const REGION_TYPES = [
  "SEA",
  "SEAF",
  "SEAU",
  "BAY",
  "CHAN",
  "LAKE",
  "RIV",
  "PARK",
  "GEOG",
  "PROV",
  "TERR",
];

// A shape travels as a ring in every filtered request's query string and in
// share links, so it is held to a few kilobytes.
export const MAX_RING_VERTICES = 150;
const KM_PER_DEGREE = 111;

export function regionSearchUrl(term, lang, limit = 20) {
  const params = new URLSearchParams({
    q: term,
    num: String(limit),
    concise: REGION_TYPES.join(","),
  });
  return `${GEONAMES_API}/${lang}/geonames.geojson?${params}`;
}

// One hit per area: GeoNames lists a feature once per province that shares
// it (the Gulf of St. Lawrence five times) under the same featureid. Only
// areas with an outline can become a filter; undersea features are points.
export function parseRegions(geojson) {
  const seen = new Set();
  return (geojson?.features ?? [])
    .filter(({ properties, geometry }) => {
      const id = properties?.featureid;
      if (!id || seen.has(id)) return false;
      if (!["Polygon", "MultiPolygon"].includes(geometry?.type)) return false;
      seen.add(id);
      return true;
    })
    .map(({ properties, geometry }) => ({
      id: properties.featureid,
      name: properties.name,
      type: properties.concise,
      geometry,
    }));
}

// The outer boundary of the region's largest part. The other parts of a
// MultiPolygon are islands and slivers, and holes are islands too.
function largestRing(geometry) {
  const rings =
    geometry.type === "Polygon"
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map((part) => part[0]);
  return rings.reduce((a, b) => (b.length > a.length ? b : a));
}

export function regionBox(geometry) {
  return turfBboxPolygon(turfBbox(geometry)).geometry.coordinates[0];
}

let turfBuffer = null;
const loadTurfBuffer = async () => {
  turfBuffer ??= (await import("@turf/buffer")).default;
  return turfBuffer;
};

// The region's outline cut down to MAX_RING_VERTICES without losing any of
// it: simplifying alone cuts across bays and drops the data near shore, so the
// outline is grown by the tolerance first. Pre-simplified (tol/4, made up by
// the 1.25 tol growth) so a coastline of thousands of points buffers quickly.
export async function regionOutline(geometry) {
  const shape = turfPolygon([largestRing(geometry)]);
  const buffer = await loadTurfBuffer();
  const outline = (tolerance) => {
    const grown = buffer(
      turfSimplify(shape, { tolerance: tolerance / 4 }),
      tolerance * 1.25 * KM_PER_DEGREE,
      { units: "kilometers", steps: 1 },
    );
    return largestRing(turfSimplify(grown, { tolerance }).geometry);
  };
  // Started where simplifying alone meets the budget, the cheap estimate, so
  // the buffered outline seldom needs a second pass.
  let tolerance = 0.005;
  while (
    turfSimplify(shape, { tolerance }).geometry.coordinates[0].length >
    MAX_RING_VERTICES
  )
    tolerance *= 1.25;
  let ring = outline(tolerance);
  while (ring.length > MAX_RING_VERTICES) {
    tolerance *= 1.25;
    ring = outline(tolerance);
  }
  return ring;
}
