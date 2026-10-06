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

router.get("/", ...pipeline({ filters: false }), async (req, res) => {
  res.send(
    (await db("cde.organizations").orderByRaw("UPPER(name)")).map(
      changePKtoPkURL,
    ),
  );
});

/**
 * @swagger
 * /organizations/roles:
 *   get:
 *     summary: List organization roles
 *     tags: [Organizations]
 *     description: Returns the contact roles (ISO 19115 CI_RoleCode) organizations hold on datasets, for the organizationRoles filter.
 *     responses:
 *       200:
 *         description: Array of role codes.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 */
router.get("/roles", ...pipeline({ filters: false }), async (req, res) => {
  const { rows } = await db.raw(
    "SELECT DISTINCT split_part(k, ':', 2) AS role FROM cde.datasets, unnest(organization_role_keys) k ORDER BY 1",
  );
  res.send(rows.map((r) => r.role));
});

module.exports = router;
