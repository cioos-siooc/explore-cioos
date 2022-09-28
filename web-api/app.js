const createError = require("http-errors");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");

const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");
const downloadRouter = require("./routes/download");
const indexRouter = require("./routes/index");
const legendRouter = require("./routes/legend");
const organizationsRouter = require("./routes/organizations");
const datasetsRouter = require("./routes/datasets");
const pointQueryRouter = require("./routes/pointQuery");
const tilesRouter = require("./routes/tiles");
const oceanVariablesRouter = require("./routes/oceanVariables");
const previewRouter = require("./routes/preview");
const platformsRouter = require("./routes/platforms");
const datasetRecordsListRouter = require("./routes/datasetRecordsList");
const downloadEstimateRouter = require("./routes/downloadEstimate");

const app = express();

// Importing @sentry/tracing patches the global hub for tracing to work.

if (process.env.ENVIRONMENT === "production") {
  console.log("Using sentry");
  Sentry.init({
    dsn: "https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595",

    // We recommend adjusting this value in production, or using tracesSampler
    // for finer control
    tracesSampleRate: 1.0,
  });
  app.use(Sentry.Handlers.requestHandler());
}

// if environement variables are set via docker, leave them
// otherwise load from .env
if (!process.env.DB_USER) require("dotenv").config();

app.use(cors());
// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/download", downloadRouter);
app.use("/legend", legendRouter);
app.use("/organizations", organizationsRouter);
app.use("/datasets", datasetsRouter);
app.use("/pointQuery", pointQueryRouter);
app.use("/tiles", tilesRouter);
app.use("/oceanVariables", oceanVariablesRouter);
app.use("/preview", previewRouter);
app.use("/platforms", platformsRouter);
app.use("/datasetRecordsList", datasetRecordsListRouter);
app.use("/downloadEstimate", downloadEstimateRouter);

app.use(Sentry.Handlers.errorHandler());

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404));
});

// error handler
app.use((err, req, res, next) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
