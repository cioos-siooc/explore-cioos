var express = require("express");
var router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");

// These routes are too small to have their own files

// gets all of them, not dependant on query
router.get("/organizations", async function (req, res, next) {
  res.send(await db("cioos_api.organizations"));
});

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
});

module.exports = router;
