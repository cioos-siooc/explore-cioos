const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

// OBIS datasets carry the sentinel https://obis.org erddap_url; excluded
// because the Data Source filter represents OBIS via /obisNodes.

router.get("/", ...pipeline({ filters: false }), async (req, res) => {
  res.send(
    (
      await db.raw(
        "SELECT DISTINCT erddap_url FROM cde.datasets WHERE erddap_url IS NOT NULL AND source_type IS DISTINCT FROM 'obis' ORDER BY erddap_url",
      )
    ).rows.map((e) => e.erddap_url),
  );
});

module.exports = router;
