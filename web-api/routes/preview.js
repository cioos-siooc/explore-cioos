const express = require("express");
// helps with async error handling in express < v5
require("express-async-errors");
const Sentry = require("@sentry/node");

/**
 * @swagger
 * /preview:
 *   get:
 *     summary: Preview sample records for a dataset profile
 *     tags: [Preview]
 *     description: Returns up to 1000 representative records from an ERDDAP dataset profile/time-series.
 *     parameters:
 *       - in: query
 *         name: dataset
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: profile
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Preview data from ERDDAP in tabledap JSON format.
 *       400:
 *         description: Missing or invalid parameters.
 */

const router = express.Router();
const axios = require("axios");
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");

/*
 * /preview
 *
 * Gets ~1000 records from an erddap dataset, given a dataset ID and a timeseries ID
 * TODO: How will this work with timeseries profiles?
 */

router.get("/", validatorMiddleware(), async (req, res, next) => {
  const NUM_RECORDS = 1000;
  const { dataset, profile } = req.query;
  const sql = `WITH step1 AS (
               SELECT d.dataset_id,
                      d.first_eov_column,
                      COALESCE(d.timeseries_id_variable,d.profile_id_variable) profile_variable,
                      COALESCE(p.timeseries_id,p.profile_id) profile,
                      d.profile_id_variable,
                              p.n_records,
                              d.erddap_url,
                              COALESCE(profile_id, timeseries_id) profile_id,
                              time_min,
                              time_max,
                              CEIL( :NUM_RECORDS /(records_per_day/24)) num_hours_needed
                      FROM   cde.profiles p
                      JOIN cde.datasets d
                      ON d.dataset_id = p.dataset_id
                      AND d.erddap_url = p.erddap_url), step2 AS
                (
                      SELECT *,
                             time_max - (interval '1 hour' * num_hours_needed) new_start_time
                      FROM   step1)
                SELECT *,
                      time_max::text,
                      new_start_time::text,
                      new_start_time<=time_min OR n_records<=:NUM_RECORDS use_whole_profile
                FROM   step2
                WHERE  profile=:profile
                AND    dataset_id=:dataset`;
  const q = db.raw(sql, { profile, dataset, NUM_RECORDS });
  const rows = await q;

  if (!rows.rows?.length) {
    throw new Error("No datasets found");
  }

  const {
    profile_variable,
    dataset_id,
    erddap_url,
    profile_id,
    time_max,
    new_start_time,
    use_whole_profile,
  } = rows.rows[0];

  let erddapQuery = `${erddap_url}/tabledap/${dataset_id}.json?&${profile_variable}=~"${profile_id}"`;
  if (!use_whole_profile) {
    // putting timeMax in case many new records were added since the profile was harvested
    erddapQuery += `&time>${new_start_time}&time<${time_max}`;
  }

  console.log("Fetching preview from ", erddapQuery);
  try {
    const { data } = await axios.get(erddapQuery);
    console.log("FOUND ", data.table?.rows?.length, " ROWS", erddapQuery);
    data.table.rows = data.table.rows.slice(0, 1000);
    res.send(data);
  } catch (error) {
    if (error.response) {
      console.error(error.response);
      Sentry.captureMessage("No preview data found at", erddapQuery);
    }
    res.send([]);
  }
});

module.exports = router;
