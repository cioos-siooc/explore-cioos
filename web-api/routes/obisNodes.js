const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * @swagger
 * /obisNodes:
 *   get:
 *     summary: List OBIS regional/thematic nodes referenced by harvested OBIS datasets
 *     tags: [OBIS]
 *     description: Returns the distinct set of OBIS node names (e.g. EurOBIS, OBIS-USA) tagged on cde.datasets rows where source_type='obis'. Used by the frontend to populate the OBIS Nodes filter.
 *     responses:
 *       200:
 *         description: Array of OBIS node names sorted alphabetically.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 */

router.get("/", cache.route(), async (req, res) => {
  const { rows } = await db.raw(`
    SELECT DISTINCT unnest(obis_nodes) AS name
    FROM cde.datasets
    WHERE source_type = 'obis'
      AND obis_nodes IS NOT NULL
    ORDER BY name
  `);
  res.send(rows);
});

module.exports = router;
