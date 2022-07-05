var express = require("express");
var router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * /organizations
 *
 * Gets the list of organizations used in CDE. Takes no arguments
 *
 * */

router.get("/", cache.route(), async function (req, res, next) {
  res.send(await db("cde.organizations").orderByRaw("UPPER(name)"));
});

module.exports = router;
