const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

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

router.get(
  "/",
  ...pipeline({ filters: false, cacheFor: "5 minutes" }),
  async (req, res) => {
    res.send(
      (
        await db.raw(
          "SELECT DISTINCT  platform FROM cde.datasets WHERE platform IS NOT NULL",
        )
      ).rows.map((e) => e.platform),
    );
  },
);

module.exports = router;
