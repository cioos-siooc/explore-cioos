var express = require("express");
var router = express.Router();
const db = require("../db");
const { eovGrouping } = require("../utils/grouping");

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

router.get("/jobs", async function (req, res, next) {
  res.send(await db("cioos_api.download_jobs").orderBy("time", "desc"));
});

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
});

module.exports = router;
