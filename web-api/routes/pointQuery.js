const express = require("express");

const router = express.Router();
const { getShapeQuery } = require("../utils/shapeQuery");
const { requiredShapeMiddleware } = require("../utils/validatorMiddlewares");

/**
 * /pointQuery
 *
 * This endpoint takes any of the filters, and requires either a lat/long or polygon shape
 * It needs all the filters so that it can estimate download size
 *
 * if no shape is given, it returns all datasets
 */

router.get("/", async (req, res, next) => {
  const rows = await getShapeQuery(req.query, false, false);
  res.send(rows);
});
module.exports = router;
