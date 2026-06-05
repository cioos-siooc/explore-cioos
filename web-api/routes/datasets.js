const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * @swagger
 * /datasets:
 *   get:
 *     summary: List datasets
 *     tags: [Datasets]
 *     description: Returns all available datasets with translated titles.
 *     responses:
 *       200:
 *         description: Array of dataset objects.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   title:
 *                     type: string
 *                   pk:
 *                     type: string
 *                   organization_pks:
 *                     type: array
 *                     items: { type: string }
 *                   platform:
 *                     type: string
 *                   title_translated:
 *                     type: object
 */
router.get("/", cache.route(), async (req, res, next) => {
  const SQL = `SELECT title, 
                      pk_url pk,
                      organization_pks,
                      platform,
                      json_build_object('en', title, 'fr', title_fr) title_translated
                      FROM cde.datasets
                      ORDER BY UPPER(title)`;

  res.send((await db.raw(SQL)).rows);
});

module.exports = router;
