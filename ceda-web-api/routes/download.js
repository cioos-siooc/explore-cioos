require("dotenv").config();
const fs = require("fs");

var express = require("express");
var router = express.Router();
const db = require("../db");

const { spawn } = require("child_process");
/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get("/test", async (req, res) => {
  res.send("test");
});

router.get("/", async (req, res) => {
  console.log("download");
  const {
    depthMin = -1000,
    depthMax = 1000,
    polygon = "[]",
    timeMin = "1800-01-01",
    timeMax = "2030-01-01",
    eovs = "temperature,salinity,pressure,oxygen",
    dataType = "Profile",
    lonMin = -180,
    lonMax = 180,
    latMin = 0,
    latMax = 90,
  } = req.query;

  // const wkt
  const wktPolygon =
    "POLYGON((" +
    JSON.parse(polygon)
      .map(([lat, lon]) => `${lat} ${lon}`)
      .join() +
    "))";
  console.log("wktPolygon", wktPolygon);

  const eovsCommaSeparatedString = eovs
    .split(",")
    .map((eov) => `'${eov}'`)
    .join();
  console.log(eovsCommaSeparatedString);

  // TODO add depth
  const SQL = `
        with profiles_subset as (
        select d.erddap_url, d.dataset_id,d.profile_variable,d.cdm_data_type, d.ckan_record->>'id' ckan_id, 'https://catalogue.cioos.ca/dataset/' ckan_url  FROM cioos_api.profiles p
        JOIN cioos_api.datasets d ON p.dataset_pk =d.pk
        where
        p.latitude_max<${latMax} and
        p.latitude_min > ${latMin} and
        p.longitude_max< ${lonMax} and
        p.longitude_min > ${lonMin} and
        p.time_min >= '${timeMin}'::timestamp AND
        p.time_max < '${timeMax}'::timestamp AND
        (d.ckan_record->'eov') \\?| array[${eovsCommaSeparatedString}] AND
        cdm_data_type='${dataType}' AND
        ST_Contains( ST_SetSRID('${wktPolygon}'::geometry,3857),geom) is true
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
        email: "cozycoops@gmail.com",
      },
      cache_filtered: tile.json_agg,
    };
    if (tile.json_agg.length === 0) {
      res.status(204);
    }
    console.log(downloaderInput);

    let data = JSON.stringify(downloaderInput);
    const downloaderInputPath =
      "/home/cioos/ceda/downloader/test/test_query.json";
    fs.writeFileSync(downloaderInputPath, data);
    console.log("wrote file", downloaderInputPath);
    const pythonPath = "/home/cioos/ceda/downloader/venv/bin/python3.8";
    const pythonDownloaderPath = "/home/cioos/ceda/downloader/example.py";
    console.log("calling:", pythonPath, pythonDownloaderPath);

    spawn(pythonPath, [pythonDownloaderPath]);

    res.status(200);
    res.send("");
  } catch (e) {
    res.status(404).send({
      error: e.toString(),
    });
  }
});

module.exports = router;
