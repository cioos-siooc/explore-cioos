const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

/**
 * @swagger
 * /oceanVariables:
 *   get:
 *     summary: List ocean variables
 *     tags: [OceanVariables]
 *     description: Returns distinct ocean variable identifiers used by datasets.
 *     responses:
 *       200:
 *         description: Array of variable names.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: string }
 */

/**
 * /oceanVariables
 *
 * Gets a list of ocean variables, in english camelCase format. Only the ones used by datasets will be returned.
 *
 * */

router.get(
  "/",
  ...pipeline({ filters: false, cacheFor: "5 minutes" }),
  async (req, res) => {
    res.send(
      (
        await db.raw(
          "SELECT DISTINCT UNNEST(eovs) ocean_variables FROM cde.datasets",
        )
      ).rows.map((e) => e.ocean_variables),
    );
  },
);

module.exports = router;
