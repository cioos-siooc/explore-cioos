var express = require("express");
var router = express.Router();
const db = require("../db");

/**
 * /organizations
 *
 * Gets the list of organizations used in CDE. Takes no arguments
 *
 * */

router.get("/", async function (req, res, next) {
  res.send(await db("cioos_api.organizations").orderBy("name"));
});

module.exports = router;
