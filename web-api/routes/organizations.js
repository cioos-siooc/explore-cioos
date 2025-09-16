const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");
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

router.get("/", cache.route(), async (req, res, next) => {
  res.send((await db("cde.organizations").orderByRaw("UPPER(name)")).map(changePKtoPkURL));
});

module.exports = router;
