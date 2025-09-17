const e = require("express");
const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * @swagger
 * /platforms:
 *   get:
 *     summary: List platform types
 *     tags: [Platforms]
 *     description: Returns distinct platform names from datasets.
 *     responses:
 *       200:
 *         description: Array of platform names.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: string }
 */

router.get("/", cache.route(), async (req, res, next) => {
  res.send((await db.raw("SELECT DISTINCT  platform FROM cde.datasets WHERE platform IS NOT NULL")).rows.map((e) => e.platform));
});

module.exports = router;
