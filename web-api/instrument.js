// Must load before express: auto-instrumentation patches modules as they
// load.
const Sentry = require("@sentry/node");

require("dotenv").config({ quiet: true });

// Gated on the DSN, not ENVIRONMENT: .env.production sets
// `juno-cioos-co-production`, not `production`.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.ENVIRONMENT || "development",
    release: process.env.SENTRY_RELEASE,
    // Sentry is US-hosted and /download's body (and its INSERT) carries the
    // user's email. v11 collects everything left unset, so spell out v10's
    // restrictive baseline.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
        response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
  console.log(`Sentry enabled (environment: ${process.env.ENVIRONMENT})`);
}
