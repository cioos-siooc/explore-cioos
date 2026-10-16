// Must be required before any router: it patches Layer.prototype's `handle`
// setter, so routes registered earlier bypass it and a rejection there exits
// the process.
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
const griddapTimeRangeRouter = require("./routes/griddapTimeRange");
const downloadEstimateRouter = require("./routes/downloadEstimate");
const scientificNamesRouter = require("./routes/scientificNames");
const obisNodesRouter = require("./routes/obisNodes");
const erddapServersRouter = require("./routes/erddapServers");
const harvestRouter = require("./routes/harvest");
const harvestDownloadsRouter = require("./routes/harvestDownloads");
const trajectoriesRouter = require("./routes/trajectories");
const nonnaRouter = require("./routes/nonna");
const coverageHistogramRouter = require("./routes/coverageHistogram");
const swaggerSpec = require("./swagger");

const app = express();

// Sentry.init() runs in instrument.js, loaded first by bin/www.

// docker sets the environment; otherwise load .env
if (!process.env.DB_USER) require("dotenv").config({ quiet: true });

// CORS_ORIGINS: "*" (default), a comma list, or "disabled". Requests with no
// Origin header are always allowed.
(() => {
  const raw = process.env.CORS_ORIGINS || "*";
  if (raw.toLowerCase() === "disabled") {
    console.log("CORS middleware disabled via CORS_ORIGINS=disabled");
    return;
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
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      console.warn("CORS blocked origin", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  };
  console.log("CORS restricted to:", allowed.join(", "));
  app.use(cors(corsOptions));
})();

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
app.use("/griddapTimeRange", griddapTimeRangeRouter);
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
app.use("/coverageHistogram", coverageHistogramRouter);

if (process.env.ENABLE_API_DOCS !== "false") {
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, { explorer: true }),
  );
  app.get("/openapi.json", (_req, res) => res.json(swaggerSpec));
  console.log("API documentation enabled at /docs and /openapi.json");
} else {
  const redirectUrl = process.env.BASE_URL || "/";
  app.use("/docs", (_req, res) => res.redirect(redirectUrl));
  app.get("/openapi.json", (_req, res) => res.redirect(redirectUrl));
  console.log(
    `API documentation disabled via ENABLE_API_DOCS=false (redirecting to ${redirectUrl})`,
  );
}

app.use((req, res, next) => {
  next(createError(404));
});

// After the routes and the 404, before the JSON handler: it only sees errors
// from middleware registered above it.
Sentry.setupExpressErrorHandler(app);

// `statusCode` is what utils/dbFilter.js marks its client errors with,
// `status` is http-errors' spelling; anything unlabelled is a 500.
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) console.error(err);

  if (res.headersSent) return next(err);

  res.status(status).json({
    error: err.message || "Internal Server Error",
    // detail/hint are where Postgres puts the useful part of a query error.
    ...(req.app.get("env") === "development"
      ? { detail: err.detail, hint: err.hint, stack: err.stack }
      : {}),
  });
});

module.exports = app;
