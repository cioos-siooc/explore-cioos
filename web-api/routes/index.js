var express = require("express");
var router = express.Router();
const db = require("../db");
const { eovGrouping } = require("../utils/grouping");

const createDBFilter = require("../utils/dbFilter");
const unique = (arr) => [...new Set(arr)];

// These routes are too small to have their own files

// gets all of them, not dependant on query
// only send organizations that have datasets with supported EOVs
router.get("/organizations", async function (req, res, next) {
  const allEOVS = Object.values(eovGrouping).flat().join(",");
  const orgs = await db.raw(
    `WITH org_pks AS (
    SELECT DISTINCT unnest(organization_pks) pk FROM cioos_api.datasets
    WHERE eovs && '{${allEOVS}}')
    SELECT o.pk,o.name,o.color from org_pks
    JOIN cioos_api.organizations o
    ON org_pks.pk=o.pk
    ORDER BY o.name`
  );
  res.send(orgs && orgs.rows);
});
router.get("/profilesCount", async function (req, res, next) {
  const filters = createDBFilter(req.query);

  const SQL = `SELECT count(*) count  FROM cioos_api.profiles p
        JOIN cioos_api.datasets d ON p.dataset_pk = d.pk
        WHERE ${filters}`;

  const count = (await db.raw(SQL)).rows[0].count;
  res.send(200, count);
});

router.get("/jobs", async function (req, res, next) {
  res.send(await db("cioos_api.download_jobs").orderBy("time", "desc"));
});

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
});

/* GET home page. */
router.get("/pointQuery", async function (req, res, next) {
  // const { point_pk } = req.params;
  const filters = createDBFilter(req.query);

  let eovsQuery = "";
  let eovsCommaSeparatedString = "";
  const { timeMax, timeMin, eovs } = req.query;
  if (eovs) {
    eovsCommaSeparatedString = unique(
      eovs
        .split(",")
        .map((eov) => eovGrouping[eov])
        .flat()
        .map((eov) => `'${eov}'`)
    ).join();

    eovsQuery = `where eov = any(array[${eovsCommaSeparatedString}])`;
  }

  const adder = 0;
  const multiplier = 1000;

  const sql = `WITH sub as (
  SELECT 
        d.pk,
        d.dataset_id,
        d.cdm_data_type,
        d.title title,
        eovs,
        organizations,
        d.erddap_url,
        sum(coalesce(nullif(date_part('days',least(${
          timeMax ? "'timeMax'," : ""
        }p.time_max)-greatest(${
    timeMin ? "'timeMin'," : ""
  }p.time_min)),0),1) * p.records_per_day) as records_count,
        
  
     (select count(*) from cioos_api.erddap_variables 
        where d.pk=dataset_pk and (
		standard_name = any((select standard_name from cioos_api.eov_to_standard_name
        ${eovsQuery} )) 
       or
		cf_role is not null or
	 	name = any(array['time', 'latitude', 'longitude', 'depth']) ) )
     
     eov_cols,



        json_agg(json_build_object(
                'profile_id',coalesce(p.profile_id, p.timeseries_id),
                'time_min',p.time_min,
                'time_max',p.time_max,
                'depth_min',p.depth_min,
                'depth_max',p.depth_max
        ) ORDER BY time_min DESC
        ) as profiles
        FROM cioos_api.profiles p
        JOIN cioos_api.datasets d
        ON p.dataset_pk =d.pk
        WHERE ${filters}
        -- AND ckan_record IS NOT NULL
        GROUP BY d.dataset_id,
        d.pk,
        d.title,
        -- ckan_record,
        eovs,
        organizations,
        d.erddap_url)
        select *,${adder} + records_count * eov_cols * ${multiplier} as size from sub`;

  console.log(sql);

  const rows = await db.raw(sql);

  res.send(rows && rows.rows);
});

module.exports = router;
