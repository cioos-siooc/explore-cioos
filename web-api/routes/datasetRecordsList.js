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
 * If just datasetPK is given, it also gets an estimate for totalDatasetSize
 *
 * It is called when a user clicks to see details on a dataset
 *
 * Shape is not required
 */

router.get("/", datasetDetailsMiddleware(), async (req, res, next) => {
  const { datasetPKs } = req.query;
  const isEntireDatasetQuery = datasetPKs && Object.keys(req.query).length === 1;

  const data = (await getShapeQuery(req.query, true, true)).pop();

  if (!data) { res.send(); return; }

  // if its the entire dataset then the estimate is for the full dataset
  if (isEntireDatasetQuery) data.totalDatasetSize = data.size;
  // also return size of entire dataset, without sending the rows again
  else data.totalDatasetSize = (await getShapeQuery({ datasetPKs }, true, false)).pop().size;

  res.send(data);
});

module.exports = router;
