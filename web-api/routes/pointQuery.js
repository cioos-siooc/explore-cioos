const express = require("express");

const router = express.Router();
const { getShapeQuery } = require("../utils/shapeQuery");
const cache = require("../utils/cache");

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
router.get("/", cache.route(), async (req, res, next) => {
  const rows = await getShapeQuery(req.query, false, false);
  res.send(rows);
});
module.exports = router;
