const express = require("express");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

router.get("/", cache.route(), async (req, res, next) => {
  const SQL = `SELECT title, 
                      pk_url pk,
                      organization_pks,
                      platform,
                      json_build_object('en', title, 'fr', title_fr) title_translated
                      FROM cde.datasets
                      ORDER BY UPPER(title)`;

  res.send((await db.raw(SQL)).rows);
});

module.exports = router;
