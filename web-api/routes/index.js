const express = require("express");

const router = express.Router();

/**
 * @swagger
 * /:
 *   get:
 *     summary: Health check
 *     tags: [Meta]
 *     description: Returns a simple rendered page confirming the API is running.
 *     responses:
 *       200:
 *         description: API is running.
 * /sentry-test:
 *   get:
 *     summary: Trigger Sentry test error
 *     tags: [Meta]
 *     description: Throws an error intentionally for Sentry integration validation.
 *     responses:
 *       500:
 *         description: Always throws.
 */

router.get("/", (req, res, next) => {
  res.render("index", { title: "CDE API" });
});

router.get("/sentry-test", (req, res, next) => {
  throw new Error("Testing sentry");
});

module.exports = router;
