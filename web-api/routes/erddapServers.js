const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

/**
 * /erddapServers
 *
 * Gets a list of ERDDAP server URLs. OBIS datasets carry the sentinel
 * https://obis.org as their erddap_url; they're excluded here because the
 * frontend's Data Source filter represents OBIS via /obisNodes instead.
 *
 * */

router.get(
  "/",
  ...pipeline({ filters: false, cacheFor: "5 minutes" }),
  async (req, res) => {
    res.send(
      (
        await db.raw(
          "SELECT DISTINCT erddap_url FROM cde.datasets WHERE erddap_url IS NOT NULL AND source_type IS DISTINCT FROM 'obis' ORDER BY erddap_url",
        )
      ).rows.map((e) => e.erddap_url),
    );
  },
);

module.exports = router;
