const e = require("express");
const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * /platforms
 *
 * Gets a list of platform types
 *
 * */

router.get("/", cache.route(), async (req, res, next) => {
  res.send((await db.raw("SELECT DISTINCT  platform FROM cde.datasets WHERE platform IS NOT NULL")).rows.map((e) => e.platform));
});

module.exports = router;
