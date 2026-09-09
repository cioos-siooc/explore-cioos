const express = require("express");

const router = express.Router();

/**
 * @swagger
 * /:
 *   get:
 *     summary: Service banner
 *     tags: [Meta]
 *     description: Confirms the API is running.
 *     responses:
 *       200:
 *         description: API is running.
 * /health:
 *   get:
 *     summary: Liveness probe
 *     tags: [Meta]
 *     description: >
 *       Container HEALTHCHECK target. Reports only that this process is
 *       serving HTTP; it deliberately does not touch Postgres or Redis, because
 *       nginx gates on web-api being healthy and a database blip should be a
 *       failing route, not the whole site going down.
 *     responses:
 *       200:
 *         description: Process is serving.
 * /sentry-test:
 *   get:
 *     summary: Trigger Sentry test error
 *     tags: [Meta]
 *     description: Throws an error intentionally for Sentry integration validation.
 *     responses:
 *       500:
 *         description: Always throws.
 */

// JSON, not res.render. These rendered .jade templates from views/, but `jade`
// has never been in package.json — so this route, and every 404 and 500 that
// went through the error handler below, threw "Cannot find module 'jade'" and
// fell through to express's default handler, which answered 500 with the
// stack trace in the response body.
router.get("/", (req, res) => {
  res.json({ name: "CDE API", status: "ok" });
});

router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

router.get("/sentry-test", () => {
  throw new Error("Testing sentry");
});

module.exports = router;
