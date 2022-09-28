const express = require("express");

const router = express.Router();

/*
 * /
 *
 * The index page has no purpose, just to check if the API is running
 *
 */

router.get("/", (req, res, next) => {
  res.render("index", { title: "CDE API" });
});

router.get("/sentry-test", (req, res, next) => {
  throw new Error("Testing sentry");
});

module.exports = router;
