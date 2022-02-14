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
  const rows = await getShapeQuery(req.query);

  // limiting # of profiles per dataset to 1000. otherwise one dataset could
  // return 75k profiles and crash the browser
  const rowsLimitedProfiles = rows.map((dataset) => ({
    ...dataset,
    profiles: dataset.profiles.slice(0, 1000),
  }));

  res.send(rowsLimitedProfiles);
});
module.exports = router;
