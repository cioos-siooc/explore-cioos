require("dotenv").config();
var express = require("express");
var router = express.Router();
const db = require("../db");
const SphericalMercator = require("@mapbox/sphericalmercator");

/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get("/:z/:x/:y.mvt", async (req, res) => {
  const { z, x, y } = req.params;
  var merc = new SphericalMercator({
    size: 256,
  });
  console.log(req.params);
  // calculate the bounding polygon for this tile
  const bbox = merc.bbox(x, y, z, false);
  console.log(bbox);
  // Query the database, using ST_AsMVTGeom() to clip the geometries
  // Wrap the whole query with ST_AsMVT(), which will create a protocol buffer
  const SQL = `
    SELECT ST_AsMVT(q, 'internal-layer-name', 4096, 'geom')
    FROM (
      SELECT
          ST_AsMVTGeom(
              geom,
              ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326),
              4096,
              256,
              true
          ) geom
      FROM cioos_api.profiles c
    ) q
  `;

  try {
    const tileRaw = await db.raw(SQL);
    const tile = tileRaw.rows[0];

    res.setHeader("Content-Type", "application/x-protobuf");

    // trigger catch if the vector tile has no data, (return a 204)
    if (tile.st_asmvt.length === 0) {
      res.status(204);
    }

    // send the tile!
    // console.log(tileRaw);
    res.send(tile.st_asmvt);
  } catch (e) {
    res.status(404).send({
      error: e.toString(),
    });
  }
});

module.exports = router;
