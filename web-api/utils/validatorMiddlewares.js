var express = require("express");
const { check, validationResult } = require("express-validator");
const router = express.Router();

const { polygonJSONToWKT } = require("./polygon");

/**
 * This validation middleware is used by /download, /pointQuery, /tiles, /legend
 * The other routes don't have any query parameters
 */
function generalFiltersMiddleWare() {
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
  ];
}
function shapeFiltersMiddleware() {
  return [
    check("polygon")
      .matches(/^[-.0-9,\[\]]+$/)
      .isJSON(),

    // check(["latMin", "latMax", "lonMin", "lonMax"])
    //   .isFloat({ min: -90, max: -90 })
    //   .optional(),
    async function checkValidShape(req, res, next) {
      const { latMin, latMax, lonMin, lonMax, polygon } = req.query;
      // this has already
      const isValidPolygon = Boolean(polygon && polygonJSONToWKT(polygon));
      // these have already been checked for type and value range
      const isValidLatLongMaxMin =
        latMin != undefined &&
        latMax != undefined &&
        lonMin != undefined &&
        lonMax != undefined;

      if (isValidPolygon || isValidLatLongMaxMin) {
        await next();
      } else {
        res.status(400).json({ errors: ["invalid shape"] });
      }
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

function validatorMiddleware() {
  return [generalFiltersMiddleWare(), errorHandler];
}
// Used by /download and /pointQuery, these both require a shape
function requiredShapeMiddleware(req, res, next) {
  return router.use([
    generalFiltersMiddleWare(),
    shapeFiltersMiddleware(),
    errorHandler,
  ]);
}
module.exports = {
  validatorMiddleware,
  requiredShapeMiddleware,
  generalFiltersMiddleWare,
};
