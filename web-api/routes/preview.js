var express = require("express");
var router = express.Router();
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const axios = require("axios");

/*
 * /legend
 *
 * Get the range of counts for the hexes/points to set the color and legend text
 * in the front end
 *
 * Takes all the filters, returns a number range for each of the 3 major zoom levels
 */
function getERDDAPData(query) {
  // TODO use erddap4js?
}
router.get("/", validatorMiddleware(), async function (req, res, next) {
  const { dataset, profile } = req.query;
  const sql = `
       with abc as (
        select dataset_id,n_records,erddap_url,coalesce(profile_id, timeseries_id) profile_id, time_min,time_max,COALESCE(NULLIF(DATE_PART('hours',time_max-time_min),0),1) hours_available, ceil(1000/(records_per_day*24)) num_hours_needed from cde.profiles),
        def as (select *,time_max - (interval '1 hour' * hours_available) new_start_time from abc)
        select dataset_id,erddap_url,profile_id,time_max::text,new_start_time::text,
          new_start_time<=time_min or n_records<=1000 use_whole_profile from def
        where profile_id='${profile}'
        AND dataset_id='${dataset}';
        `;

  const rows = await db.raw(sql);
  console.log(sql);
  // console.log(rows.rows);
  const {
    dataset_id,
    erddap_url,
    profile_id,
    time_max,
    new_start_time,
    use_whole_profile,
  } = rows.rows[0];

  let erddapQuery = `${erddap_url}/tabledap/${dataset_id}.dataTable?&profile=~"${profile_id}"`;
  // TODO this doesnt work cause hours_available isnt calculated right
  if (!use_whole_profile) {
    // putting timeMax in case many new records were added since the profile was harvested
    erddapQuery += `&time>${new_start_time}&time<${time_max}`;
  }
  console.log(erddapQuery);
  // const erddapData = await axios.get(erddapQuery);
  // res.send(erddapData);
});

module.exports = router;
