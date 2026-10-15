const express = require("express");
const { check } = require("express-validator");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");
const { DATASET_HAS_FEATURES } = require("../utils/selection");

/**
 * @swagger
 * /datasets:
 *   get:
 *     summary: List datasets
 *     tags: [Datasets]
 *     description: Returns every dataset with something to show on the map, with translated titles.
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
router.get("/", ...pipeline({ filters: false }), async (req, res) => {
  const SQL = `SELECT title,
                      pk_url pk,
                      organization_pks,
                      platform,
                      erddap_url,
                      json_build_object('en', title, 'fr', title_fr) title_translated
                      FROM cde.datasets d
                      WHERE ${DATASET_HAS_FEATURES}
                      ORDER BY UPPER(title)`;

  res.send((await db.raw(SQL)).rows);
});

/**
 * @swagger
 * /datasets/metadata:
 *   get:
 *     summary: A dataset's descriptive metadata
 *     tags: [Datasets]
 *     description: >
 *       Abstract, citation, contacts, license, keywords, dates, extents and
 *       resources, normalized and merged by the harvester (CKAN first, then the
 *       converted OBIS record, then ERDDAP's globals). Every field is optional;
 *       an empty object means the dataset has not been harvested since the
 *       column was added.
 *     parameters:
 *       - in: query
 *         name: datasetPKs
 *         required: true
 *         schema: { type: integer }
 *         description: >
 *           The dataset's pk_url (the plural name kept for consistency with
 *           the other routes; one pk only).
 *     responses:
 *       200:
 *         description: The metadata object.
 *       404:
 *         description: No dataset has this pk.
 */
router.get(
  "/metadata",
  ...pipeline({
    filters: false,
    checks: [check("datasetPKs").isInt({ min: 0 })],
  }),
  async (req, res) => {
    const { rows } = await db.raw(
      "SELECT metadata FROM cde.datasets WHERE pk_url = :pk LIMIT 1",
      { pk: Number(req.query.datasetPKs) },
    );
    if (!rows?.length) {
      return res.status(404).send({ error: "DATASET_NOT_FOUND" });
    }
    res.send(rows[0].metadata ?? {});
  },
);

module.exports = router;
