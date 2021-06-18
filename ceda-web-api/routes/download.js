require("dotenv").config();
const fs = require("fs");

var express = require("express");
var router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");

const { spawn } = require("child_process");
/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get("/", async (req, res) => {
  console.log("download");
  const { email } = req.query;
  const filters = createDBFilter(req.query);
  // const wkt
  const wktPolygon =
    "POLYGON((" +
    JSON.parse(polygon)
      .map(([lat, lon]) => `${lat} ${lon}`)
      .join() +
    "))";
  console.log("wktPolygon", wktPolygon);

  // TODO add depth
  const SQL = `
        with profiles_subset as (
        select d.erddap_url, d.dataset_id,d.profile_variable,d.cdm_data_type, d.ckan_record->>'id' ckan_id, 'https://catalogue.cioos.ca/dataset/' ckan_url  FROM cioos_api.profiles p
        JOIN cioos_api.datasets d ON p.dataset_pk =d.pk
        where
        ${filters ? filters + " AND " : ""} 

        ST_Contains( ST_SetSRID('${wktPolygon}'::geometry,3857),geom) is true
        group by d.pk)
        select json_agg(t) from profiles_subset t;`;

  console.log(SQL);
  try {
    const tileRaw = await db.raw(SQL);
    const tile = tileRaw.rows[0];

    const downloader_input = {
      user_query: {
        time_min: timeMin,
        time_max: timeMax,
        lat_min: latMin,
        lat_max: latMax,
        lon_min: lonMin,
        lon_max: lonMax,
        depth_min: depthMin,
        depth_max: depthMax,
        polygon_region: wktPolygon,
        eovs: eovs.split(","),
        email: "cozycoops@gmail.com",
        zip_filename: "zip_filename",
      },
      cache_filtered: tile.json_agg,
    };
    if (tile.json_agg.length === 0) {
      res.status(204);
    }
    // add to the jobs queue
    await db("cioos_api.datasets").insert({
      downloader_input: downloaderInput,
    });

    res.status(200);
    res.send("");
  } catch (e) {
    res.status(404).send({
      error: e.toString(),
    });
  }
});

module.exports = router;
