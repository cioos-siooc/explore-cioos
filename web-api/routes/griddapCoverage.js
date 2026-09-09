const express = require("express");

const router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { pipeline } = require("../utils/routePipeline");
const {
  erddapVisible,
  GRIDDAP_TIME_DEPTH_COLUMNS,
  GRIDDAP_FROM,
} = require("../utils/selection");

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
router.get("/", ...pipeline(), async (req, res) => {
  // Griddap is ERDDAP-only, so an OBIS-only selection contains none of it —
  // see utils/selection.js for what makes a selection OBIS-only.
  if (!erddapVisible(req.query)) {
    return res.send({ type: "FeatureCollection", features: [] });
  }

  const filters = await createDBFilter(req.query);

  // The CTE aliases the coverage_* columns back to the names dbFilter's
  // unqualified predicates expect — see utils/selection.js, which the shape
  // query's griddap arm takes the same aliases from. `d.*` keeps every dataset
  // column the shared filters may reference (pk_url, eovs, platform,
  // organization_pks, obis_nodes, erddap_url) alongside them.
  const sql = `WITH grids AS (
        SELECT d.*,
               ${GRIDDAP_TIME_DEPTH_COLUMNS},
               NULL::integer AS point_pk,
               d.coverage_bbox AS search_geom
        ${GRIDDAP_FROM})
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
