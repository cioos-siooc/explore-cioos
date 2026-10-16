import turfBbox from "@turf/bbox";
import turfBboxPolygon from "@turf/bbox-polygon";
import { polygon as turfPolygon } from "@turf/helpers";
import turfSimplify from "@turf/simplify";

// NRCan's Canadian Geographical Names Database: bilingual, open to the browser
// (CORS *), and it returns each named area's outline with the hit.
export const GEONAMES_API = "https://geogratis.gc.ca/services/geoname";

// The feature types someone would look for ocean data around: areas, and
// coastal or undersea places. The rest (mountains, forests, roads…) are inland.
export const REGION_TYPES = [
  "SEA",
  "SEAF",
  "SEAU",
  "BAY",
  "CHAN",
  "SHL",
  "CAPE",
  "ISL",
  "LAKE",
  "RIV",
  "PARK",
  "GEOG",
  "PROV",
  "TERR",
  "CITY",
  "TOWN",
  "VILG",
  "UNP",
];

// A shape travels as a ring in every filtered request's query string and in
// share links, so it is held to a few kilobytes.
export const MAX_RING_VERTICES = 150;
const KM_PER_DEGREE = 111;

// GeoNames matches whole words only, so the last word gets a Lucene `*` to
// match as it is typed. Not after punctuation: "st.*" matches nothing.
export function prefixQuery(term) {
  const words = term.trim().split(/\s+/);
  const last = words.at(-1);
  if (!/^[\p{L}\p{N}-]+$/u.test(last)) return term.trim();
  return [...words.slice(0, -1), `${last}*`].join(" ");
}

export function regionRecordUrl(cgndbid, lang) {
  return `${GEONAMES_API}/${lang}/geonames/${cgndbid}.html`;
}

export function regionSearchUrl(term, lang, limit = 20) {
  const params = new URLSearchParams({
    q: term,
    num: String(limit),
    concise: REGION_TYPES.join(","),
  });
  return `${GEONAMES_API}/${lang}/geonames.geojson?${params}`;
}

// Canada Post symbols, the same in both languages, by GeoNames province code.
// 72 (undersea) and 73 (international waters) name no province.
const PROVINCE_SYMBOLS = {
  10: "NL",
  11: "PE",
  12: "NS",
  13: "NB",
  24: "QC",
  35: "ON",
  46: "MB",
  47: "SK",
  48: "AB",
  59: "BC",
  60: "YT",
  61: "NT",
  62: "NU",
};

// One hit per feature: GeoNames lists a feature once per province that shares
// it and once per official name (the Gulf of St. Lawrence five times), each
// with the whole shape, under the same featureid. Their provinces, locations
// and other names are gathered so same-named places can be told apart; the
// names carry no language, so a bilingual one's `otherNames` are shown beside
// it rather than one guessed for the UI language. Every hit
// can be gone to; only an `area` (one with an outline) can become a filter,
// since places such as towns and undersea features are points.
export function parseRegions(geojson) {
  const byId = new Map();
  for (const { properties, geometry } of geojson?.features ?? []) {
    const id = properties?.featureid;
    if (!id || !geometry) continue;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: properties.name,
        cgndbid: properties.cgndbid,
        type: properties.concise,
        geometry,
        area: ["Polygon", "MultiPolygon"].includes(geometry.type),
        names: new Set(),
        provinces: new Set(),
        locations: new Set(),
      });
    }
    const region = byId.get(id);
    region.names.add(properties.name);
    const province = PROVINCE_SYMBOLS[properties.province];
    if (province) region.provinces.add(province);
    if (properties.location) region.locations.add(properties.location);
  }
  return [...byId.values()].map(
    ({ names, provinces, locations, ...region }) => ({
      ...region,
      otherNames: [...names].filter((n) => n !== region.name),
      provinces: [...provinces],
      locations: [...locations],
    }),
  );
}

// "Island · Kings, NB", or "Bay · NB, NS" for a place across provinces, whose
// locations belong to one province each.
export function regionDescription({ type, provinces, locations }, t) {
  const where =
    locations.length === 1 && provinces.length <= 1
      ? [locations[0], ...provinces].join(", ")
      : provinces.join(", ");
  return [t(`regionType${type}`, { defaultValue: "" }), where]
    .filter(Boolean)
    .join(" · ");
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
