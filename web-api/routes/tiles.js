require("dotenv").config();
var express = require("express");
var router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { cdmDataTypeGrouping } = require("../utils/grouping");
console.log("Connecting to redis at", process.env.REDIS_HOST);
var cache = require("express-redis-cache")({
  host: process.env.REDIS_HOST,
});

cache.on("error", function (error) {
  console.error("Running without Redis, that's ok");
  cache.removeAllListeners();
  // hide more error messages
  cache.on("error", () => {});
});

/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get("/:z/:x/:y.mvt", cache.route({ binary: true }), async (req, res) => {
  const { z, x, y } = req.params;

  const filters = createDBFilter(req.query);

  const isHexGrid = z < 7;
  const zoomColumn = z < 5 ? "hex_zoom_0" : "hex_zoom_1";

  // calculate the bounding polygon for this tile
  const sqlQuery = {
    table: "cioos_api.profiles",
    geom_column: isHexGrid ? zoomColumn : "geom",
  };

  // eg (^Point$|^TimeSeries$)
  // eventually we can just populate is_station in the database
  const typeStr = cdmDataTypeGrouping["fixedStations"]
    .map((t) => `'${t}'`)
    .join(",");

  const SQL = `
  with relevent_points as (
        SELECT count(*) count, ${
          isHexGrid
            ? ""
            : `point_pk as pk, (d.cdm_data_type = any(array[${typeStr}]))::integer pointtype,`
        } p.${sqlQuery.geom_column} as geom from cioos_api.profiles p
        JOIN cioos_api.datasets d ON p.dataset_pk =d.pk 
       ${filters ? "WHERE " + filters : ""}
        ${
          isHexGrid
            ? `group by ${sqlQuery.geom_column}`
            : "group by point_pk,geom, cdm_data_type"
        } ),
    te as (select ST_TileEnvelope(${z}, ${x}, ${y}) tile_envelope ),
    mvtgeom as (
      SELECT count,
       ${isHexGrid ? "" : "pk,pointtype,"}
        ST_AsMVTGeom (
          relevent_points.geom,
          tile_envelope
        ) as geom
      FROM
        relevent_points, te
      WHERE relevent_points.geom && tile_envelope
    
    )
    SELECT ST_AsMVT(mvtgeom.*, 'internal-layer-name', 4096, 'geom' ${
      sqlQuery.id_column ? `, '${sqlQuery.id_column}'` : ""
    }) AS st_asmvt from mvtgeom;
  `;

  try {
    const tileRaw = await db.raw(SQL);

    const tile = tileRaw.rows[0];

    res.setHeader("Content-Type", "application/x-protobuf");

    // trigger catch if the vector tile has no data, (return a 204)
    if (tile.st_asmvt.length === 0) {
      res.status(204);
    }
    res.status(200).send(tile.st_asmvt);
  } catch (e) {
    res.status(404).send({
      error: e.toString(),
    });
  }
});

module.exports = router;
