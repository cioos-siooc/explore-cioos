var express = require("express");
var router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

router.get("/", cache.route(), async function (req, res, next) {
  res.send(
    await db("cioos_api.datasets")
      .select("title", "pk", "organization_pks")
      .orderByRaw("UPPER(title)")
  );
});

module.exports = router;
