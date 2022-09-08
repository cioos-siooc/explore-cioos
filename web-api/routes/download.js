require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
var express = require("express");
var router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { getShapeQuery } = require("../utils/shapeQuery");
const { polygonJSONToWKT } = require("../utils/polygon");
const { requiredShapeMiddleware } = require("../utils/validatorMiddlewares");
const { check } = require("express-validator");

/**
 * /download
 * Requires a shape (either polygon or latMin/Max) and email
 */

router.get(
  "/",
  requiredShapeMiddleware(),
  check("email").isEmail(),
  async (req, res, next) => {
    const {
      timeMin,
      timeMax,
      latMin,
      latMax,
      depthMin,
      depthMax,
      lonMin,
      lonMax,
      email,
      polygon,
      lang = "en",
    } = req.query;

    const shapeQueryResponse = await getShapeQuery(req.query);
    const estimateTotalSize = shapeQueryResponse.reduce(
      (partialSum, { size }) => partialSum + size,
      0
    );

    const filters = createDBFilter(req.query);

    const wktPolygon = polygonJSONToWKT(polygon);

    const SQL = `
        WITH profiles_subset AS (
        SELECT d.erddap_url,
               d.dataset_id,
               d.title,
               d.profile_variables,
               d.cdm_data_type,
               d.ckan_id ckan_id,
               'https://catalogue.cioos.ca/dataset/' ckan_url
        FROM cde.profiles p
        JOIN cde.datasets d ON p.dataset_pk =d.pk
        WHERE
        ${filters ? filters : ""} 
        GROUP BY d.pk)
        SELECT json_agg(t) FROM profiles_subset t;      
      `;

    console.log(SQL);

    try {
      const tileRaw = await db.raw(SQL);
      const tile = tileRaw.rows[0];
      if (tile.json_agg && tile.json_agg.length) {
        const jobID = uuidv4().substr(0, 6);
        const downloaderInput = {
          user_query: {
            language: lang,
            time_min: timeMin,
            time_max: timeMax,
            lat_min: Number.parseFloat(latMin),
            lat_max: Number.parseFloat(latMax),
            lon_min: Number.parseFloat(lonMin),
            lon_max: Number.parseFloat(lonMax),
            depth_min: Number.parseFloat(depthMin),
            depth_max: Number.parseFloat(depthMax),
            polygon_region: wktPolygon,
            email,
            job_id: jobID,
          },
          cache_filtered: tile.json_agg,
        };
        // add to the jobs queue

        const downloadJobEntry = {
          job_id: jobID,
          email: email,
          downloader_input: downloaderInput,
          estimate_details: JSON.stringify(shapeQueryResponse),
          estimate_size: estimateTotalSize,
        };
        console.log(downloadJobEntry);
        await db("cde.download_jobs").insert(downloadJobEntry);

        count = tile.json_agg.length;
      }
      res.send({ count });
    } catch (e) {
      res.status(404).send({
        error: e.toString(),
      });
    }
  }
);

module.exports = router;
