const { check, validationResult } = require("express-validator");

const cache = require("./cache");
const { polygonJSONToWKT } = require("./polygon");
const { METRICS } = require("./hexMetric");
const { ALL_PROFILE_TYPES, ALL_TRAJECTORY_TYPES } = require("./dataTypes");

/*
 * The request contract, and the order the stages run in.
 *
 * Every route that takes the map's filter set used to assemble its own
 * validate -> filter -> query -> cache chain, and the stage ORDER differed:
 * /legend and /timeExtent registered the cache before the validator, /tiles
 * and /datasetRecordsList after. `pipeline()` below is the one assembly point,
 * so a route names what it needs and cannot get the order wrong.
 */

// Free-text values that /platforms, /obisNodes and /erddapServers hand back
// verbatim (platform names, OBIS node titles, ERDDAP URLs) — there is no
// character class that holds them, and none is needed: every one is bound as a
// query parameter, never interpolated. What is worth bounding is size, since
// each is split into an array fed to `= ANY(...)`.
const MAX_LIST_LENGTH = 4000;

// A comma list drawn from a fixed vocabulary. Empty means "none of them",
// which is a real selection (every geometry of that group switched off) and
// not the same as the param being absent — see utils/dataTypes.js.
const isTypeList = (all) => (value) =>
  value === "" ||
  String(value)
    .split(",")
    .every((t) => all.includes(t));

/**
 * The map's filter set. Every route that narrows the catalogue takes all of
 * it, so it is validated in one place instead of per route.
 */
function filterValidators() {
  return [
    check(["timeMin", "timeMax"]).isISO8601().optional(),
    check(["depthMin", "depthMax"])
      .isInt({ min: -999999, max: 999999 })
      .optional(),
    // comma separated list of pks, eg pointPKs=12342,34534,456456
    check(["organizations", "datasetPKs", "pointPKs"])
      .matches(/^[0-9,]*$/)
      .optional(),
    check("eovs")
      .matches(/^[a-zA-Z,]*$/)
      .optional(),
    check("scientificNames")
      // letters, digits, space, period, comma, apostrophe, parens, hyphen
      // (accommodates subgenus notation like "Halichondria (Halichondria) phakellioides")
      .matches(/^[A-Za-z0-9 .,'()-]*$/)
      .isLength({ max: 4000 })
      .optional(),
    check(["platforms", "obisNodes", "erddapServers"])
      .isLength({ max: MAX_LIST_LENGTH })
      .optional(),
    // Source and layer switches. Only "false" is ever meaningful (the routes
    // read `!== "false"`), but accepting exactly the two spellings keeps a
    // typo'd flag from silently reading as "on".
    check(["includeObis", "includeTrajectory"])
      .isIn(["true", "false"])
      .optional(),
    // Which number the hex ramp counts. utils/hexMetric.js defaults an absent
    // param; a present-but-unknown one is a client bug worth reporting,
    // because /tiles and /legend would both silently fall back and the caller
    // would never learn its choice was ignored.
    check("metric").isIn(METRICS).optional(),
    check("profileTypes").custom(isTypeList(ALL_PROFILE_TYPES)).optional(),
    check("trajectoryTypes")
      .custom(isTypeList(ALL_TRAJECTORY_TYPES))
      .optional(),
  ];
}

/**
 * The drawn selection: either a polygon, or a complete lat/lon rectangle, or
 * neither. A half-specified rectangle is rejected rather than silently
 * defaulting its missing sides to the world extent.
 */
function shapeValidators() {
  return [
    check("polygon")
      .matches(/^[-.0-9,[\]]+$/)
      .isJSON()
      .optional(),

    check(["latMin", "latMax"]).isFloat({ min: -90, max: 90 }).optional(),
    // 360 to accomodate mapbox world copies
    check(["lonMin", "lonMax"]).isFloat({ min: -360, max: 360 }).optional(),
    async function checkValidShape(req, res, next) {
      const { latMin, latMax, lonMin, lonMax, polygon } = req.query;
      // this has already
      const isValidPolygon = Boolean(polygon && polygonJSONToWKT(polygon));

      // these have already been checked for type and value range
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

// Slippy-map tile coordinates. Unvalidated, a non-numeric `z` reached
// ST_TileEnvelope / ST_Expand as NaN and came back a 500; an in-range-looking
// but out-of-grid x/y is a request no upstream should be made to serve.
// ST_TileEnvelope rejects zooms above 31; 22 is past the deepest tile any of
// these layers publishes.
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

const DEFAULT_CACHE_DURATION = "5 minutes";

/**
 * The middleware chain every route registers, in one order:
 * validate -> reject -> cache -> handler.
 *
 * The cache comes last because apicache stores whatever status the chain
 * produces: with it registered first, a 400 was written to the request's cache
 * key and served from there. Validating first also means a cached entry was
 * valid at the moment it was stored.
 *
 * Returns a fresh array on every call. The old `requiredShapeMiddleware`
 * returned a module-level `express.Router()` it had `use`d the stack onto, so
 * a second route mounting it appended a second copy of every validator.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.filters]     apply the shared map-filter validators
 * @param {boolean}  [opts.shape]       also require a coherent polygon/rectangle
 * @param {object}   [opts.tileParams]  validate :z/:x/:y ({maxZoom} to narrow)
 * @param {Array}    [opts.checks]      route-specific validators
 * @param {?string}  [opts.cacheFor]    apicache duration, or null for no cache
 */
function pipeline({
  filters = true,
  shape = false,
  tileParams = null,
  checks = [],
  cacheFor = DEFAULT_CACHE_DURATION,
  cacheToggle = undefined,
} = {}) {
  return [
    ...(tileParams ? tileParamValidators(tileParams) : []),
    ...(filters ? filterValidators() : []),
    ...(shape ? shapeValidators() : []),
    ...checks,
    errorHandler,
    // `cacheToggle` decides per response whether it may be stored/served —
    // see cache.onlyOk, for a route whose upstream can fail.
    ...(cacheFor === null ? [] : [cache.route(cacheFor, cacheToggle)]),
  ];
}

module.exports = {
  pipeline,
  filterValidators,
  shapeValidators,
  tileParamValidators,
  errorHandler,
  MAX_TILE_ZOOM,
};
