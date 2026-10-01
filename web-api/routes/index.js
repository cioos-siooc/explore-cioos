const express = require("express");
const db = require("../db");
const redis = require("../utils/redis");

const router = express.Router();

const READY_CHECK_TIMEOUT_MS = 2000;
// The scheduler polls every 0.5s, so an open job this old means nothing is
// consuming the queue. Same threshold as download_scheduler's
// test_queue_liveness.py.
const DOWNLOAD_QUEUE_STUCK_AFTER_S = 5 * 60;

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
 * /health/ready:
 *   get:
 *     summary: Readiness probe
 *     tags: [Meta]
 *     description: >
 *       Checks what the site needs to work: Postgres, Redis, and that the
 *       download queue is being consumed. Answers 503 when Postgres is
 *       unreachable or an open download job has waited over 5 minutes. A
 *       Redis failure only reports "degraded", since the API falls back to an
 *       in-memory cache without it. Probed by the nginx container healthcheck.
 *     responses:
 *       200:
 *         description: Ready (status "ok" or "degraded").
 *       503:
 *         description: Postgres unreachable or download queue stuck.
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

async function check(fn) {
  try {
    return {
      ok: true,
      ...(await redis.withTimeout(fn(), READY_CHECK_TIMEOUT_MS, "check")),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

router.get("/health/ready", async (req, res) => {
  const [queue, cache] = await Promise.all([
    check(async () => {
      const { rows } = await db.raw(
        "SELECT extract(epoch FROM now() - min(time))::int AS oldest_open_seconds FROM cde.download_jobs WHERE status = 'open'",
      );
      return { oldestOpenSeconds: rows[0].oldest_open_seconds };
    }),
    check(async () => {
      const client = await redis.ensureConnected();
      if (!client) throw new Error("redis unavailable");
      await client.ping();
    }),
  ]);
  const checks = {
    db: { ok: queue.ok, ...(queue.error && { error: queue.error }) },
    redis: cache,
    downloadQueue: {
      ok: queue.ok && !(queue.oldestOpenSeconds > DOWNLOAD_QUEUE_STUCK_AFTER_S),
      oldestOpenSeconds: queue.oldestOpenSeconds ?? null,
    },
  };
  const ready = checks.db.ok && checks.downloadQueue.ok;
  const status = !ready ? "down" : checks.redis.ok ? "ok" : "degraded";
  res.status(ready ? 200 : 503).json({ status, checks });
});

router.get("/sentry-test", () => {
  throw new Error("Testing sentry");
});

module.exports = router;
