const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * /erddapServers
 *
 * Gets a list of ERDDAP server URLs
 *
 * */

router.get("/", cache.route(), async (req, res, next) => {
  res.send((await db.raw("SELECT DISTINCT erddap_url FROM cde.datasets WHERE erddap_url IS NOT NULL ORDER BY erddap_url")).rows.map((e) => e.erddap_url));
});

module.exports = router;
