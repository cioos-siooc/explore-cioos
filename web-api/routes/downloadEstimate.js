require("dotenv").config();
const express = require("express");

const router = express.Router();
const { getShapeQuery } = require("../utils/shapeQuery");

/**
 * @swagger
 * /downloadEstimate:
 *   get:
 *     summary: Estimate download sizes for selected datasets
 *     tags: [Download]
 *     description: Returns size estimates for given dataset PKs and optional filters.
 *     parameters:
 *       - in: query
 *         name: datasetPKs
 *         required: true
 *         schema: { type: string }
 *         description: Comma-separated dataset primary keys.
 *     responses:
 *       200:
 *         description: Array of size estimates.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   pk: { type: string }
 *                   dataset_id: { type: string }
 *                   size: { type: number }
 */

router.get("/", async (req, res, next) => {
  let shapeQueryResponse;
  try {
    shapeQueryResponse = await getShapeQuery(req.query, true, false);
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    throw err;
  }
  res.send(
    shapeQueryResponse.map((row) => ({
      pk: row.pk_url,
      dataset_id: row.dataset_id,
      size: row.size,
    })),
  );
});

module.exports = router;
