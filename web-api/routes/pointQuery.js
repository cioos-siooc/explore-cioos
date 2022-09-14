var express = require("express");
var router = express.Router();
const { getShapeQuery } = require("../utils/shapeQuery");
const { requiredShapeMiddleware } = require("../utils/validatorMiddlewares");

/**
 * /pointQuery
 *
 * This endpoint takes any of the filters, and requires either a lat/long or polygon shape
 * It needs all the filters so that it can estimate download size
 */

router.get("/", requiredShapeMiddleware(), async function (req, res, next) {
  /**
   * Size estimation calculation:
   * (days in query that overlap with days in profile) *
   * (the profile's `records_per_day` which is precalculated) *
   * (fraction of the profile's depth range that overlaps with query) *
   * (number of columns in final CSV) * multiplier
   */
  const rows = await getShapeQuery(req.query,true,true);

  const rowsWithCount = rows.map((dataset) => ({
    ...dataset,
    profiles_count: dataset.profiles.length,
  }));

  res.send(rowsWithCount);
});
module.exports = router;
