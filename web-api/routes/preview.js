var express = require("express");
// helps with async error handling in express < v5
require("express-async-errors");
var router = express.Router();
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const axios = require("axios");

/*
 * /preview
 *
 * Gets ~1000 records from an erddap dataset, given a dataset ID and a timeseries ID
 * TODO: How will this work with timeseries profiles?
 */

router.get("/", validatorMiddleware(), async function (req, res, next) {
  const { dataset, profile } = req.query;
  const sql = `
                WITH step1 AS
                (
                      SELECT dataset_id,
                              n_records,
                              erddap_url,
                              COALESCE(profile_id, timeseries_id) profile_id,
                              time_min,
                              time_max,
                              CEIL(:NUM_RECORDS/(records_per_day/24)) num_hours_needed
                      FROM   cde.profiles), step2 AS
                (
                      SELECT *,
                             time_max - (interval '1 hour' * num_hours_needed) new_start_time
                      FROM   step1)
                SELECT *,
                      time_max::text,
                      new_start_time::text,
                      new_start_time<=time_min OR n_records<=:NUM_RECORDS: use_whole_profile
                FROM   step2
                WHERE  profile_id=:profile
                AND    dataset_id=:dataset
                LIMIT 1`;

  const rows = await db.raw(sql, { profile, dataset, NUM_RECORDS: 1000 });

  if (!rows.rows?.length) {
    throw new Error("No datasets found");
  }

  const {
    dataset_id,
    erddap_url,
    profile_id,
    time_max,
    new_start_time,
    use_whole_profile,
  } = rows.rows[0];

  let erddapQuery = `${erddap_url}/tabledap/${dataset_id}.json?&profile=~"${profile_id}"`;
  if (!use_whole_profile) {
    // putting timeMax in case many new records were added since the profile was harvested
    erddapQuery += `&time>${new_start_time}&time<${time_max}`;
  }

  const { data } = await axios.get(erddapQuery);
  console.log("FOUND ", data?.table?.rows?.length, " ROWS", erddapQuery);
  res.send(data?.table);
});

module.exports = router;
