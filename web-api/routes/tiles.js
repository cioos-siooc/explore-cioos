require("dotenv").config();
const express = require("express");

const router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");
/**
 * /tiles/z/x/y/.mvt
 *
 * Tile generator - returns the hex shapes or points with some data attached
 * Takes all the filters
 */

/**
 * @swagger
 * /tiles/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of map data
 *     tags: [Tiles]
 *     description: Returns a Mapbox Vector Tile containing either hex bins or points with dataset aggregation.
 *     parameters:
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: MVT binary tile.
 *         content:
 *           application/x-protobuf:
 *             schema:
 *               type: string
 *               format: binary
 */
/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get(
  "/:z/:x/:y.mvt",
  validatorMiddleware(),
  cache.route({ binary: true }),
  async (req, res) => {
    const { z, x, y } = req.params;

    const filters = createDBFilter(req.query);
    const hasFilter = filters.toSQL().sql;

    // zoom levels: 0-4,5-6,7+
    const isHexGrid = z < 7;
    const zoomColumn = z < 5 ? "hex_zoom_0" : "hex_zoom_1";
    const zoomPKColumn = z < 5 ? "hex_0_pk" : "hex_1_pk";

    // calculate the bounding polygon for this tile
    const sqlQuery = {
      table: "cde.profiles",
      // if its a zoom level where hexes are show, return the hex shapes, otherwise return a point
      geom_column: isHexGrid ? zoomColumn : "geom",
    };
    // not joining to cde.points to get hexagons as that could be slower
    const SQL = `
  with relevent_points as (
    ${
  isHexGrid
    ? "SELECT :zoomPKColumn: pk,count(distinct point_pk) count,"
    : "SELECT point_pk pk, d.platform as platform,sum(p.days)::bigint count,"
} array_to_json(array_agg(distinct d.pk_url)) datasets,     
      p.:geom_column: AS geom FROM cde.profiles p
        -- used for organizations filtering
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk 
       ${hasFilter ? "WHERE :filters" : ""}
        ${
  isHexGrid ? "GROUP BY :zoomPKColumn:,p.:geom_column:" : "GROUP BY geom,point_pk,platform"
} ),
    te AS (select ST_TileEnvelope(:z, :x, :y) tile_envelope ),
    mvtgeom AS (
      SELECT pk,count, 
       ${isHexGrid ? "" : "platform,"} datasets,
        ST_AsMVTGeom (
          relevent_points.geom,
          tile_envelope
        ) AS geom
      FROM
        relevent_points, te
      WHERE relevent_points.geom && tile_envelope
    )
    SELECT ST_AsMVT(mvtgeom.*, 'internal-layer-name', 4096, 'geom') AS st_asmvt from mvtgeom;
  `;

    try {
      const q = db.raw(SQL, {
        filters,
        zoomPKColumn,
        geom_column: sqlQuery.geom_column,
        z,
        x,
        y,
      });

      const tileRaw = await q;
      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
  },
);

module.exports = router;
