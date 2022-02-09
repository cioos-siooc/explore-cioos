var express = require("express");
var router = express.Router();

/*
 * /
 *
 * The index page has no purpose, just to check if the API is running
 *
 */

router.get("/", function (req, res, next) {
  res.render("index", { title: "CDE API" });
});

module.exports = router;
