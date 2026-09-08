// Must be required before any router module: it patches the `handle` SETTER on
// express's Layer.prototype, so only routes registered after this line get
// their async rejections forwarded to the error handler. Routes registered
// earlier assign `handle` as an own property and bypass the patch entirely —
// a rejected promise there is an unhandled rejection, which Node turns into a
// process exit, taking every other in-flight request down with it.
require("express-async-errors");

const createError = require("http-errors");
const express = require("express");
const logger = require("morgan");
const cors = require("cors");

const Sentry = require("@sentry/node");
const swaggerUi = require("swagger-ui-express");
const downloadRouter = require("./routes/download");
const indexRouter = require("./routes/index");
const legendRouter = require("./routes/legend");
const timeExtentRouter = require("./routes/timeExtent");
const organizationsRouter = require("./routes/organizations");
const datasetsRouter = require("./routes/datasets");
const pointQueryRouter = require("./routes/pointQuery");
const tilesRouter = require("./routes/tiles");
const oceanVariablesRouter = require("./routes/oceanVariables");
const previewRouter = require("./routes/preview");
const platformsRouter = require("./routes/platforms");
const datasetRecordsListRouter = require("./routes/datasetRecordsList");
const griddapCoverageRouter = require("./routes/griddapCoverage");
const downloadEstimateRouter = require("./routes/downloadEstimate");
const scientificNamesRouter = require("./routes/scientificNames");
const obisNodesRouter = require("./routes/obisNodes");
const erddapServersRouter = require("./routes/erddapServers");
const harvestRouter = require("./routes/harvest");
const harvestDownloadsRouter = require("./routes/harvestDownloads");
const trajectoriesRouter = require("./routes/trajectories");
const nonnaRouter = require("./routes/nonna");
const swaggerSpec = require("./swagger");

const app = express();

// Sentry.init() runs in instrument.js, loaded first by bin/www.

// if environement variables are set via docker, leave them
// otherwise load from .env
if (!process.env.DB_USER) require("dotenv").config({ quiet: true });

// CORS configuration via environment variable:
//  - CORS_ORIGINS="*" (default) allows all origins
//  - CORS_ORIGINS="https://a.com,https://b.com" restricts to listed origins
//  - CORS_ORIGINS="disabled" (case-insensitive) disables CORS middleware entirely
//  - Non-browser / same-origin server-to-server requests (no Origin header) are always allowed when CORS enabled
(() => {
  const raw = process.env.CORS_ORIGINS || "*";
  if (raw.toLowerCase() === "disabled") {
    console.log("CORS middleware disabled via CORS_ORIGINS=disabled");
    return; // do not install cors()
  }

  if (raw === "*") {
    app.use(cors({ origin: true, credentials: true }));
    console.log("CORS allowing all origins (*).");
    return;
  }

  const allowed = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const corsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true); // e.g. curl / server-side
      if (allowed.includes(origin)) return callback(null, true);
      console.warn("CORS blocked origin", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  };
  console.log("CORS restricted to:", allowed.join(", "));
  app.use(cors(corsOptions));
})();

// No view engine and no static dir. views/*.jade, public/, cookie-parser and
// the jade engine were express-generator scaffolding in a service that only
// ever answers JSON and vector tiles — and `jade` was never installed, so
// every res.render() threw. Nothing here sets or reads a cookie either.
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use("/", indexRouter);
app.use("/download", downloadRouter);
app.use("/legend", legendRouter);
app.use("/timeExtent", timeExtentRouter);
app.use("/organizations", organizationsRouter);
app.use("/datasets", datasetsRouter);
app.use("/pointQuery", pointQueryRouter);
app.use("/tiles", tilesRouter);
app.use("/oceanVariables", oceanVariablesRouter);
app.use("/preview", previewRouter);
app.use("/platforms", platformsRouter);
app.use("/datasetRecordsList", datasetRecordsListRouter);
app.use("/griddapCoverage", griddapCoverageRouter);
app.use("/downloadEstimate", downloadEstimateRouter);
app.use("/scientificNames", scientificNamesRouter);
app.use("/obisNodes", obisNodesRouter);
app.use("/erddapServers", erddapServersRouter);
// Mounted before /harvest so its literal paths aren't matched by that
// router's /:runId-style routes.
app.use("/harvest/downloads", harvestDownloadsRouter);
app.use("/harvest", harvestRouter);
app.use("/trajectories", trajectoriesRouter);
app.use("/nonna", nonnaRouter);

// Swagger docs - conditionally enabled via ENABLE_API_DOCS environment variable
if (process.env.ENABLE_API_DOCS !== "false") {
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, { explorer: true }),
  );
  app.get("/openapi.json", (_req, res) => res.json(swaggerSpec));
  console.log("API documentation enabled at /docs and /openapi.json");
} else {
  // Redirect to BASE_URL when API docs are disabled
  const redirectUrl = process.env.BASE_URL || "/";
  app.use("/docs", (_req, res) => res.redirect(redirectUrl));
  app.get("/openapi.json", (_req, res) => res.redirect(redirectUrl));
  console.log(
    `API documentation disabled via ENABLE_API_DOCS=false (redirecting to ${redirectUrl})`,
  );
}

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404));
});

// After the routes and the 404, before the JSON handler below — it only
// sees errors from middleware registered above it, and it reports 500s.
Sentry.setupExpressErrorHandler(app);

// error handler. JSON, and the stack only outside production — express's
// default handler was answering every error with an HTML page containing the
// full stack trace, because the res.render() above it threw first.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Internal Server Error",
    ...(req.app.get("env") === "development" ? { stack: err.stack } : {}),
  });
});

module.exports = app;
