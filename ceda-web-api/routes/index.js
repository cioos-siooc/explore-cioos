var express = require("express");
var router = express.Router();
const db = require("../db");
const { eovGrouping } = require("../utils/grouping");

const createDBFilter = require("../utils/dbFilter");

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
    ON org_pks.pk=o.pk::text
`
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
router.get("/pointQuery/:point_pk", async function (req, res, next) {
  const { point_pk } = req.params;
  const point_pk_split = point_pk.split(",").map((e) => Number.parseInt(e));
  const rows = await db.raw(
    `SELECT 
        d.dataset_id,
        ckan_record->>'title' title,
        eovs,
        parties,
        d.erddap_url,
        json_agg(json_build_object(
                'profile_id',p.profile_id,
                'time_min',p.time_min,
                'time_max',p.time_max,
                'depth_min',p.depth_min,
                'depth_max',p.depth_max
        ) ORDER BY time_min DESC
        ) as profiles
        FROM cioos_api.profiles p
        JOIN cioos_api.datasets d
        ON p.dataset_pk =d.pk
        WHERE point_pk = ANY(:point_pk_split)
        GROUP BY d.dataset_id,
        ckan_record,
        eovs,
        parties,
        d.erddap_url`,
    { point_pk_split }
  );

  res.send(rows && rows.rows);
});

module.exports = router;
