const express = require("express");
const db = require("../db");
const { getShapeQuery } = require("../utils/shapeQuery");

const router = express.Router();
const { datasetDetailsMiddleware } = require("../utils/validatorMiddlewares");

/**
 * @swagger
 * /datasetRecordsList:
 *   get:
 *     summary: Get dataset record details and size estimate
 *     tags: [Datasets]
 *     description: Returns a dataset's record list and size estimates based on current filters.
 *     parameters:
 *       - in: query
 *         name: datasetPk
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Dataset record list summary.
 */

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
