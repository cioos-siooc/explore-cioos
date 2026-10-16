const { check, validationResult } = require("express-validator");

const cache = require("./cache");
const { polygonJSONToWKT } = require("./polygon");
const { METRICS } = require("./hexMetric");
const { ALL_PROFILE_TYPES, ALL_TRAJECTORY_TYPES } = require("./dataTypes");

// Free text (platform names, node titles, URLs) is always bound, never
// interpolated, so only size is bounded.
const MAX_LIST_LENGTH = 4000;

// Empty means "none of them" (a real selection), not absent — see
// utils/dataTypes.js.
const isTypeList = (all) => (value) =>
  value === "" ||
  String(value)
    .split(",")
    .every((t) => all.includes(t));

function filterValidators() {
  return [
    check(["timeMin", "timeMax"]).isISO8601().optional(),
    check(["depthMin", "depthMax"])
      .isInt({ min: -999999, max: 999999 })
      .optional(),
    check([
      "organizations",
      "excludeOrganizations",
      "datasetPKs",
      "excludeDatasetPKs",
      "pointPKs",
    ])
      .matches(/^[0-9,]*$/)
      .optional(),
    check(["eovs", "excludeEovs"])
      .matches(/^[a-zA-Z,]*$/)
      .optional(),
    check(["eovsMatch", "organizationsMatch", "scientificNamesMatch"])
      .isIn(["any", "all"])
      .optional(),
    check(["scientificNames", "excludeScientificNames"])
      // allows subgenus notation like "Halichondria (Halichondria) phakellioides"
      .matches(/^[A-Za-z0-9 .,'()-]*$/)
      .isLength({ max: 4000 })
      .optional(),
    check([
      "platforms",
      "obisNodes",
      "erddapServers",
      "excludePlatforms",
      "excludeObisNodes",
      "excludeErddapServers",
    ])
      .isLength({ max: MAX_LIST_LENGTH })
      .optional(),
    // Only "false" is meaningful, but rejecting other spellings keeps a typo
    // from silently reading as "on".
    check(["includeObis", "includeTrajectory", "realtimeOnly"])
      .isIn(["true", "false"])
      .optional(),
    // /tiles and /legend would silently fall back on an unknown metric.
    check("metric").isIn(METRICS).optional(),
    check("profileTypes").custom(isTypeList(ALL_PROFILE_TYPES)).optional(),
    check("trajectoryTypes")
      .custom(isTypeList(ALL_TRAJECTORY_TYPES))
      .optional(),
  ];
}

// A half-specified rectangle is rejected rather than defaulted.
function shapeValidators() {
  return [
    check("polygon")
      .matches(/^[-.0-9,[\]]+$/)
      .isJSON()
      .optional(),

    check(["latMin", "latMax"]).isFloat({ min: -90, max: 90 }).optional(),
    // 360 to accommodate map world copies
    check(["lonMin", "lonMax"]).isFloat({ min: -360, max: 360 }).optional(),
    async function checkValidShape(req, res, next) {
      const { latMin, latMax, lonMin, lonMax, polygon } = req.query;
      const isValidPolygon = Boolean(polygon && polygonJSONToWKT(polygon));

      const isBoundingBox =
        latMin !== undefined ||
        latMax !== undefined ||
        lonMin !== undefined ||
        lonMax !== undefined;

      const isValidLatLongMaxMin =
        latMin !== undefined &&
        latMax !== undefined &&
        lonMin !== undefined &&
        lonMax !== undefined;

      if (
        (polygon && isValidPolygon) ||
        (isBoundingBox && isValidLatLongMaxMin) ||
        (!isBoundingBox && !polygon)
      ) {
        await next();
      } else {
        res.status(400).json({ errors: ["invalid shape"] });
      }
    },
  ];
}

// ST_TileEnvelope rejects zooms above 31; 22 is past the deepest tile any
// layer publishes.
const MAX_TILE_ZOOM = 22;

function tileParamValidators({ maxZoom = MAX_TILE_ZOOM } = {}) {
  return [
    function checkTileCoords(req, res, next) {
      const { z, x, y } = req.params;
      const zoom = Number(z);
      if (!Number.isInteger(zoom) || zoom < 0 || zoom > maxZoom) {
        return res
          .status(400)
          .json({ errors: [`zoom must be an integer 0-${maxZoom}`] });
      }
      const col = Number(x);
      const row = Number(y);
      const tilesPerAxis = 2 ** zoom;
      if (
        !Number.isInteger(col) ||
        col < 0 ||
        col >= tilesPerAxis ||
        !Number.isInteger(row) ||
        row < 0 ||
        row >= tilesPerAxis
      ) {
        return res.status(400).json({
          errors: [`tile ${x}/${y} is outside the grid at zoom ${zoom}`],
        });
      }
      next();
    },
  ];
}

async function errorHandler(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessage = { errors: errors.array() };
    console.error(errorMessage);
    return res.status(400).json(errorMessage);
  }
  await next();
}

// Everything cached is derived from the harvest, which flushes redis
// (harvester/cde_harvester/prefect_pipeline.py); the TTL is only a safety net.
// apicache derives the browser max-age from this too, so nginx overrides it
// ($api_browser_cache in nginx/nginx.conf).
const DEFAULT_CACHE_DURATION = "24 hours";

// apicache only stores a response with a body, and Express answers a
// conditional request with a bodiless 304, so a revalidating miss would never
// fill the cache (measured 3.2 s every time vs 15 ms once filled). This runs
// only on a miss; hits still get apicache's own cheap ETag 304.
function fullResponseForCacheMiss(req, res, next) {
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  next();
}

// Cache after validation: apicache stores whatever status the chain produces,
// so a 400 would otherwise be cached.
function pipeline({
  filters = true,
  shape = false,
  tileParams = null,
  checks = [],
  cacheFor = DEFAULT_CACHE_DURATION,
  cacheToggle = cache.onlyOk,
} = {}) {
  return [
    ...(tileParams ? tileParamValidators(tileParams) : []),
    ...(filters ? filterValidators() : []),
    ...(shape ? shapeValidators() : []),
    ...checks,
    errorHandler,
    // Defaulting to 200-only keeps a transient error from becoming a hit.
    ...(cacheFor === null
      ? []
      : [cache.route(cacheFor, cacheToggle), fullResponseForCacheMiss]),
  ];
}

module.exports = {
  pipeline,
  fullResponseForCacheMiss,
  filterValidators,
  shapeValidators,
  tileParamValidators,
  errorHandler,
  MAX_TILE_ZOOM,
};
