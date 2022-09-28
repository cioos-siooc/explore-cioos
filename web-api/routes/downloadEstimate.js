require("dotenv").config();
const express = require("express");

const router = express.Router();
const { getShapeQuery } = require("../utils/shapeQuery");

/**
 * /downloadEstimate
 * Requires a list of dataset PKs, eg datasetPKs=1,2,3 the other filters are optional
 */

router.get(
  "/",
  async (req, res, next) => {
    const shapeQueryResponse = await getShapeQuery(req.query, true, false);
    res.send(shapeQueryResponse.map((row) => (
      { pk: row.pk, dataset_id: row.dataset_id, size: row.size })));
  },
);

module.exports = router;
