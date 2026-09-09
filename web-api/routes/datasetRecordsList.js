const express = require("express");
const { check } = require("express-validator");
const { getShapeQuery } = require("../utils/shapeQuery");
const { pipeline } = require("../utils/routePipeline");

const router = express.Router();

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
router.get(
  "/",
  ...pipeline({ checks: [check("datasetPKs").isInt()] }),
  async (req, res) => {
    const rows = await getShapeQuery(req.query, false, true);
    res.send(rows.pop());
  },
);

module.exports = router;
