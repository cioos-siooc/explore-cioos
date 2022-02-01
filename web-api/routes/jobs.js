var express = require("express");
var router = express.Router();
const db = require("../db");

router.get("/", async function (req, res, next) {
  res.send(await db("cioos_api.download_jobs").orderBy("time", "desc"));
});

module.exports = router;
