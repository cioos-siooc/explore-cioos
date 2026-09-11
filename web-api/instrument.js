// Loaded as the very first statement of bin/www, before express is required.
// v8+ auto-instrumentation patches modules as they load, so anything required
// ahead of Sentry.init is never instrumented.
const Sentry = require("@sentry/node");

require("dotenv").config({ quiet: true });

// Gated on the DSN, not on ENVIRONMENT: this used to test
// `ENVIRONMENT === "production"`, but .env.production sets
// `juno-cioos-co-production`, so Sentry was never initialised in production.
if (process.env.SENTRY_DSN) {
  // Tracing every request adds per-request overhead across the initial-load
  // burst, so sample a fraction by default. Override with
  // SENTRY_TRACES_SAMPLE_RATE.
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.ENVIRONMENT || "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
  console.log(`Sentry enabled (environment: ${process.env.ENVIRONMENT})`);
}
