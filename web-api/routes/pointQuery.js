const express = require("express");

const router = express.Router();
const { getShapeQuery, getDatasetPksInShape } = require("../utils/shapeQuery");
const { pipeline } = require("../utils/routePipeline");

/**
 * /pointQuery
 *
 * This endpoint takes any of the filters, and requires either a lat/long or polygon shape
 * It needs all the filters so that it can estimate download size
 *
 * if no shape is given, it returns all datasets
 */

/**
 * @swagger
 * /pointQuery:
 *   get:
 *     summary: Query datasets by spatial/temporal filters
 *     tags: [Query]
 *     description: Returns datasets matching filters and optional spatial shape.
 *     parameters:
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: latMin
 *         schema: { type: number }
 *       - in: query
 *         name: latMax
 *         schema: { type: number }
 *       - in: query
 *         name: lonMin
 *         schema: { type: number }
 *       - in: query
 *         name: lonMax
 *         schema: { type: number }
 *       - in: query
 *         name: depthMin
 *         schema: { type: number }
 *       - in: query
 *         name: depthMax
 *         schema: { type: number }
 *       - in: query
 *         name: polygon
 *         schema: { type: string }
 *         description: GeoJSON polygon string.
 *     responses:
 *       200:
 *         description: Array of dataset query results with size estimates.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
router.get("/", ...pipeline(), async (req, res) => {
  res.send(await getShapeQuery(req.query, false, false));
});

/**
 * @swagger
 * /pointQuery/inView:
 *   get:
 *     summary: Datasets with a matched feature inside a rectangle
 *     tags: [Query]
 *     description: >
 *       Takes the same filters and shape as /pointQuery and returns only the
 *       pks of the datasets that have a feature matching them. The frontend
 *       sends the map viewport as latMin/latMax/lonMin/lonMax to decide which
 *       datasets are in view — a dataset's bbox overlapping the view is not
 *       enough for one spread across a whole ocean.
 *     responses:
 *       200:
 *         description: Array of dataset pks.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: integer }
 */
router.get("/inView", ...pipeline(), async (req, res) => {
  res.send(await getDatasetPksInShape(req.query));
});
module.exports = router;
