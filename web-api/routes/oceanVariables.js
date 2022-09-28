const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * /oceanVariables
 *
 * Gets a list of ocean variables, in english camelCase format. Only the ones used by datasets will be returned.
 *
 * */

router.get("/", cache.route(), async (req, res, next) => {
  res.send(
    (
      await db.raw(
        "SELECT DISTINCT UNNEST(eovs) ocean_variables FROM cde.datasets",
      )
    ).rows.map((e) => e.ocean_variables),
  );
});

module.exports = router;
