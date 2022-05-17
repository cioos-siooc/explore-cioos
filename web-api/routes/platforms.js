var express = require("express");
var router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * /platforms
 *
 * Gets a list of platform types
 *
 * */

router.get("/", cache.route(), async function (req, res, next) {
  res.send((await db.raw("SELECT DISTINCT l06_platform_code pk,platform_type from cioos_api.datasets WHERE platform_type IS NOT NULL")).rows);
});

module.exports = router;


