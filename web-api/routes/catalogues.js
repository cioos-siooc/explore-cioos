const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

/**
 * @swagger
 * /catalogues:
 *   get:
 *     summary: List the data portals (CKAN organizations that own harvested datasets' catalogue records) and the sources within each
 *     tags: [CKAN]
 *     description: One row per distinct cde.datasets.ckan_owner (e.g. St. Lawrence Global Observatory (SLGO), CIOOS Pacific), with the ERDDAP servers it runs, whether it owns OBIS records, and its sources (cde.datasets.ckan_sources, e.g. Hakai Institute, or the portal itself), each with its own servers and OBIS flag. A server belongs to the owner, and within it the source, of most of its datasets. Used by the frontend to build the Data Portal filter.
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
 *                   sources:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         hasObis:
 *                           type: boolean
 *                         erddapServers:
 *                           type: array
 *                           items:
 *                             type: string
 */

// Rows harvested before ckan_sources existed count as their owner's.
router.get("/", ...pipeline({ filters: false }), async (req, res) => {
  const { rows } = await db.raw(`
    WITH tagged AS (
      SELECT ckan_owner AS owner,
             unnest(coalesce(ckan_sources, ARRAY[ckan_owner])) AS source,
             source_type IS NOT DISTINCT FROM 'obis' AS is_obis,
             erddap_url
      FROM cde.datasets
      WHERE ckan_owner IS NOT NULL
    ), owner_servers AS (
      SELECT DISTINCT ON (erddap_url) erddap_url, ckan_owner AS owner
      FROM cde.datasets
      WHERE ckan_owner IS NOT NULL AND source_type IS DISTINCT FROM 'obis'
      GROUP BY erddap_url, ckan_owner
      ORDER BY erddap_url, count(*) DESC, ckan_owner
    ), source_servers AS (
      SELECT DISTINCT ON (t.erddap_url) t.erddap_url, t.owner, t.source
      FROM tagged t
      JOIN owner_servers os USING (erddap_url, owner)
      WHERE NOT t.is_obis
      GROUP BY t.erddap_url, t.owner, t.source
      ORDER BY t.erddap_url, count(*) DESC, t.source
    ), sources AS (
      SELECT t.owner, t.source AS name, bool_or(t.is_obis) AS has_obis,
             coalesce(
               array_agg(DISTINCT ss.erddap_url)
                 FILTER (WHERE ss.erddap_url IS NOT NULL),
               '{}'
             ) AS erddap_servers
      FROM tagged t
      LEFT JOIN source_servers ss ON ss.owner = t.owner AND ss.source = t.source
      GROUP BY t.owner, t.source
    )
    SELECT s.owner AS name, bool_or(s.has_obis) AS "hasObis",
           coalesce(
             (SELECT array_agg(os.erddap_url ORDER BY os.erddap_url)
              FROM owner_servers os WHERE os.owner = s.owner),
             '{}'
           ) AS "erddapServers",
           json_agg(
             json_build_object(
               'name', s.name,
               'hasObis', s.has_obis,
               'erddapServers', s.erddap_servers
             ) ORDER BY s.name
           ) AS sources
    FROM sources s
    GROUP BY s.owner
    ORDER BY s.owner
  `);
  res.send(rows);
});

module.exports = router;
