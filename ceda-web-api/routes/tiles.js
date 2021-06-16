require("dotenv").config();
var express = require("express");
var router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { cdmDataTypeGrouping } = require("../utils/grouping");

/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get("/:z/:x/:y.mvt", async (req, res) => {
  const { z, x, y } = req.params;

  const filters = createDBFilter(req.query);

  const isHexGrid = z < 7;
  const zoomColumn = z < 3 ? "geom_snapped_0" : "geom_snapped_1";

  console.log("req.query");
  console.log(req.query);
  // calculate the bounding polygon for this tile

  const sqlQuery = {
    table: "cioos_api.profiles",
    geom_column: isHexGrid ? zoomColumn : "geom",
  };

  // eg (^Point$|^TimeSeries$)
  // eventually we can just populate is_station in the database
  const typeStr = cdmDataTypeGrouping["fixedStations"]
    .map((t) => `^${t}$`)
    .join("|");

  const SQL = `
  with relevent_points as (
        SELECT ${
          isHexGrid
            ? "count(*) count,"
            : `p.pk,(d.cdm_data_type~'(${typeStr})')::integer pointtype,`
        } p.${sqlQuery.geom_column} as geom from cioos_api.profiles p
        JOIN cioos_api.datasets d ON p.dataset_pk =d.pk 
       ${filters ? "WHERE " + filters : ""}
        ${isHexGrid ? ` group by ${sqlQuery.geom_column}` : ""} ),
    te as (select ST_TileEnvelope(${z}, ${x}, ${y}) tile_envelope ),
    mvtgeom as (
      SELECT
       ${isHexGrid ? ` count,` : "pk,pointtype,"}
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

  console.log(SQL);
  try {
    const tileRaw = await db.raw(SQL);

    const tile = tileRaw.rows[0];

    res.setHeader("Content-Type", "application/x-protobuf");

    // trigger catch if the vector tile has no data, (return a 204)
    if (tile.st_asmvt.length === 0) {
      res.status(204);
    }

    // send the tile!
    res.send(tile.st_asmvt);
  } catch (e) {
    res.status(404).send({
      error: e.toString(),
    });
  }
});

module.exports = router;
