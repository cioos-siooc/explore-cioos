require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
var express = require("express");
var router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");

const { spawn } = require("child_process");
/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get("/", async (req, res) => {
  const {
    timeMin,
    timeMax,
    latMin,
    latMax,
    depthMin,
    depthMax,
    lonMin,
    lonMax,
    eovs,
    email,
    polygon,
  } = req.query;

  console.log("download");

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

        ST_Contains(ST_Transform(ST_SetSRID('${wktPolygon}'::geometry,4326),3857),geom) is true
        group by d.pk)
        select json_agg(t) from profiles_subset t;`;

  console.log(SQL);
  try {
    const tileRaw = await db.raw(SQL);
    const tile = tileRaw.rows[0];

    const downloaderInput = {
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
        email,
        zip_filename: `ceda_download_${uuidv4().substr(0, 6)}.zip`,
      },
      cache_filtered: tile.json_agg,
    };

    // add to the jobs queue
    await db("cioos_api.download_jobs").insert({
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
