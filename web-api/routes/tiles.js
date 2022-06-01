require("dotenv").config();
var express = require("express");
var router = express.Router();
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

/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get(
  "/:z/:x/:y.mvt",
  validatorMiddleware(),
  cache.route({ binary: true }),
  async (req, res) => {
    const { z, x, y } = req.params;

    const filters = createDBFilter(req.query);

    // zoom levels: 0-4,5-6,7+
    const isHexGrid = z < 7;
    const zoomColumn = z < 5 ? "hex_zoom_0" : "hex_zoom_1";

    // calculate the bounding polygon for this tile
    const sqlQuery = {
      table: "cioos_api.profiles",
      // if its a zoom level where hexes are show, return the hex shapes, otherwise return a point
      geom_column: isHexGrid ? zoomColumn : "geom",
    };
    // not joining to cioos_api.points to get hexagons as that could be slower
    const SQL = `
  with relevent_points as (
    ${isHexGrid ? " SELECT count(distinct point_pk) count," : " SELECT sum(p.days)::bigint count,array_to_json(array_agg(distinct dataset_pk)) datasets, "}    
      ${isHexGrid ? "" : `d.l06_platform_code as platform,point_pk AS pk,`} p.${
      sqlQuery.geom_column
    } AS geom FROM cioos_api.profiles p
        -- used for organizations filtering
        JOIN cioos_api.datasets d
        ON p.dataset_pk = d.pk 
       ${filters ? "WHERE " + filters : ""}
        ${
          isHexGrid
            ? `GROUP BY ${sqlQuery.geom_column}`
            : "GROUP BY point_pk, geom, d.l06_platform_code"
        } ),
    te AS (select ST_TileEnvelope(${z}, ${x}, ${y}) tile_envelope ),
    mvtgeom AS (
      SELECT count, 
       ${isHexGrid ? "" : "pk,platform,datasets,"}
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
      console.log(SQL);
      const tileRaw = await db.raw(SQL);

      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
  }
);

module.exports = router;
