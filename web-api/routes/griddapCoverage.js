const express = require("express");

const router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const cache = require("../utils/cache");

/**
 * /griddapCoverage
 *
 * GeoJSON FeatureCollection of the bounding boxes of griddap (gridded,
 * metadata-only) datasets matching the shared filters. Feeds the optional
 * "gridded dataset coverage" map layer — dataset counts are tens of rows, so
 * no pagination or tiling is needed.
 */

/**
 * @swagger
 * /griddapCoverage:
 *   get:
 *     summary: Bounding boxes of matching griddap datasets
 *     tags: [Query]
 *     description: >
 *       GeoJSON FeatureCollection of gridded-dataset coverage rectangles,
 *       filtered by the same query parameters as /pointQuery.
 *     responses:
 *       200:
 *         description: GeoJSON FeatureCollection.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get("/", cache.route(), async (req, res, next) => {
  const { scientificNames, obisNodes, erddapServers } = req.query;
  // Same gating as shapeQuery's includeProfiles: scientific-name filters and
  // OBIS-node-only selections hide ERDDAP data, and griddap is ERDDAP-only.
  const includeProfiles = !scientificNames && (!obisNodes || Boolean(erddapServers));
  if (!includeProfiles) {
    return res.send({ type: "FeatureCollection", features: [] });
  }

  let filters;
  try {
    filters = await createDBFilter(req.query);
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    throw err;
  }

  // The CTE aliases the coverage_* columns back to the names dbFilter's
  // unqualified predicates expect (time_min, depth_min, point_pk,
  // search_geom); d.* keeps every dataset column the shared filters may
  // reference (pk_url, eovs, platform, organization_pks, obis_nodes,
  // erddap_url). NULL point_pk keeps grids out of map-click queries.
  const sql = `WITH grids AS (
        SELECT d.*,
               coalesce(d.coverage_time_min, '-infinity'::timestamptz) AS time_min,
               coalesce(d.coverage_time_max, 'infinity'::timestamptz) AS time_max,
               coalesce(d.coverage_depth_min, 0) AS depth_min,
               coalesce(d.coverage_depth_max, 0) AS depth_max,
               NULL::integer AS point_pk,
               d.coverage_bbox AS search_geom
          FROM cde.datasets d
         WHERE d.cdm_data_type = 'Grid' AND d.coverage_bbox IS NOT NULL)
  SELECT json_build_object(
           'type', 'FeatureCollection',
           'features', coalesce(json_agg(
             json_build_object(
               'type', 'Feature',
               'geometry', ST_AsGeoJSON(ST_Transform(d.search_geom, 4326), 6)::json,
               'properties', json_build_object(
                 'pk', d.pk_url,
                 'dataset_id', d.dataset_id,
                 'title_translated', json_build_object('en', d.title, 'fr', d.title_fr),
                 'wms_url', d.wms_url,
                 'erddap_url', d.erddap_url || '/griddap/' || d.dataset_id || '.html'
               )
             )
           ), '[]'::json)
         ) AS fc
    FROM grids d
   WHERE :filters`;

  const rows = await db.raw(sql, { filters: filters.shared });
  res.send(rows.rows[0].fc);
});

module.exports = router;
