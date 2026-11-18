const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

/**
 * @swagger
 * /catalogues:
 *   get:
 *     summary: List the data portals (CKAN organizations that own harvested datasets' catalogue records)
 *     tags: [CKAN]
 *     description: One row per distinct cde.datasets.ckan_owner (e.g. St. Lawrence Global Observatory (SLGO), CIOOS Pacific), with the ERDDAP servers it runs and whether it owns OBIS records. A server belongs to the owner of most of its datasets. Used by the frontend to build the Data Portal filter.
 *     responses:
 *       200:
 *         description: Array of portals sorted by name.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   hasObis:
 *                     type: boolean
 *                   erddapServers:
 *                     type: array
 *                     items:
 *                       type: string
 */

router.get("/", ...pipeline({ filters: false }), async (req, res) => {
  const { rows } = await db.raw(`
    WITH owners AS (
      SELECT ckan_owner AS name, bool_or(source_type = 'obis') AS has_obis
      FROM cde.datasets
      WHERE ckan_owner IS NOT NULL
      GROUP BY ckan_owner
    ), servers AS (
      SELECT DISTINCT ON (erddap_url) erddap_url, ckan_owner
      FROM cde.datasets
      WHERE ckan_owner IS NOT NULL AND source_type IS DISTINCT FROM 'obis'
      GROUP BY erddap_url, ckan_owner
      ORDER BY erddap_url, count(*) DESC, ckan_owner
    )
    SELECT o.name, o.has_obis AS "hasObis",
           coalesce(
             array_agg(s.erddap_url ORDER BY s.erddap_url)
               FILTER (WHERE s.erddap_url IS NOT NULL),
             '{}'
           ) AS "erddapServers"
    FROM owners o
    LEFT JOIN servers s ON s.ckan_owner = o.name
    GROUP BY o.name, o.has_obis
    ORDER BY o.name
  `);
  res.send(rows);
});

module.exports = router;
