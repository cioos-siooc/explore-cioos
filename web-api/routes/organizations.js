const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");
const { changePKtoPkURL } = require("../utils/misc");

/**
 * @swagger
 * /organizations:
 *   get:
 *     summary: List organizations
 *     tags: [Organizations]
 *     description: Returns all organizations referenced by datasets.
 *     responses:
 *       200:
 *         description: Array of organizations.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   pk_url:
 *                     type: string
 */

router.get(
  "/",
  ...pipeline({ filters: false, cacheFor: "5 minutes" }),
  async (req, res) => {
    res.send(
      (await db("cde.organizations").orderByRaw("UPPER(name)")).map(
        changePKtoPkURL,
      ),
    );
  },
);

module.exports = router;
