var express = require("express");
var router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * /oceanVariables
 *
 * Gets a list of ocean variables, in english camelCase format. Only the ones used by datasets will be returned.
 *
 * */

router.get("/", cache.route(), async function (req, res, next) {
  res.send((await db.raw("SELECT DISTINCT UNNEST(ceda_eovs) ocean_variables FROM cioos_api.datasets")).rows.map(e=>e.ocean_variables));
});

module.exports = router;


