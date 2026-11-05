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

// The source's citation, else one built from its metadata: source_citation in
// downloader/cioos_downloader/package.py, so the list cites as the package does.
function compactCitation(row, lang) {
  const metadata = row.metadata || {};
  const localized = (field) => field?.[lang] || field?.en || field?.fr;
  const tidy = (text) => String(text).replace(/\s+/g, " ").trim();
  const own = localized(metadata.citation);
  if (own) return /[.!?]$/.test(tidy(own)) ? tidy(own) : `${tidy(own)}.`;

  const contacts = metadata.contacts || [];
  const cited = contacts.filter((c) => c.cited);
  const authors = (cited.length ? cited : contacts)
    .map((c) => c.name || c.organization)
    .filter(Boolean)
    .join("; ");
  const dates = metadata.dates || {};
  const date = dates.published || dates.created || dates.revised;
  const year = date ? String(date).slice(0, 4) : null;
  const head = authors ? authors + (year ? ` (${year})` : "") : year;
  const title = (lang === "fr" && row.title_fr) || row.title || row.dataset_id;
  return `${[head, title, metadata.doi || row.landing_url]
    .filter(Boolean)
    .map((part) => part.replace(/\.$/, ""))
    .join(". ")}.`;
}

/**
 * @swagger
 * /datasets/citations:
 *   get:
 *     summary: Datasets' licence and citation
 *     tags: [Datasets]
 *     description: >
 *       Each dataset's licence and a one-line citation, as the download
 *       package cites it (the source's own citation, else one built from its
 *       metadata).
 *     parameters:
 *       - in: query
 *         name: datasetPKs
 *         required: true
 *         schema: { type: string }
 *         description: Comma-separated pk_url values.
 *       - in: query
 *         name: lang
 *         schema: { type: string, enum: [en, fr], default: en }
 *     responses:
 *       200:
 *         description: One object per known dataset.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   pk: { type: integer }
 *                   license: { type: string, nullable: true }
 *                   license_url: { type: string, nullable: true }
 *                   citation: { type: string }
 */
router.get(
  "/citations",
  ...pipeline({
    filters: false,
    checks: [
      check("datasetPKs").matches(/^[0-9]+(,[0-9]+)*$/),
      check("lang").isIn(["en", "fr"]).optional(),
    ],
  }),
  async (req, res) => {
    const { rows } = await db.raw(
      `SELECT pk_url AS pk, dataset_id, title, title_fr, metadata,
              CASE WHEN source_type = 'obis'
                   THEN 'https://obis.org/dataset/' || dataset_id
                   ELSE erddap_url || '/info/' || dataset_id || '/index.html'
              END AS landing_url
       FROM cde.datasets
       WHERE pk_url = ANY (:pks)`,
      { pks: req.query.datasetPKs.split(",").map(Number) },
    );
    const lang = req.query.lang || "en";
    res.send(
      rows.map((row) => {
        const license = row.metadata?.license || {};
        return {
          pk: row.pk,
          license: license.title?.replace(/\s+/g, " ").trim() || null,
          license_url: license.url || null,
          citation: compactCitation(row, lang),
        };
      }),
    );
  },
);

module.exports = router;
