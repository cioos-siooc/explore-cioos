const express = require("express");
const db = require("../db");
const { getShapeQuery } = require("../utils/shapeQuery");

const router = express.Router();
const { datasetDetailsMiddleware } = require("../utils/validatorMiddlewares");

/**
 * /datasetRecordsList
 *
 * This endpoint takes any of the filters and requires a dataset PK
 * It needs all the filters so that it can estimate download size
  *
 * It is called when a user clicks to see details on a dataset
 *
 * Shape is not required
 */

router.get("/", datasetDetailsMiddleware(), async (req, res, next) => {
  const data = (await getShapeQuery(req.query, false, true)).pop();
  res.send(data);
});

module.exports = router;
