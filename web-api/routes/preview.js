const express = require("express");
const { check } = require("express-validator");
const Sentry = require("@sentry/node");

/**
 * @swagger
 * /preview:
 *   get:
 *     summary: Preview sample records for a dataset record
 *     tags: [Preview]
 *     description: >
 *       Returns up to 1000 representative rows for one record of an ERDDAP
 *       dataset. A "record" is the dataset's CF discrete-sampling feature: a
 *       station for TimeSeries/TimeSeriesProfile, a cast for Profile, a
 *       mission/deployment for Trajectory/TrajectoryProfile.
 *     parameters:
 *       - in: query
 *         name: dataset
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: profile
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: >
 *           Preview data from ERDDAP in tabledap JSON format
 *           (table.columnNames / columnTypes / columnUnits / rows), plus
 *           table.columnMeta - one harvested per-variable metadata object per
 *           column, positionally aligned to columnNames, null where the harvest
 *           knows no such column. The key is absent entirely for a dataset that
 *           has not been harvested since datasets.table_variables was added.
 *       400:
 *         description: Missing or invalid parameters.
 *       404:
 *         description: Unknown dataset, unknown record, or the record holds no data.
 *       422:
 *         description: The dataset declares no CF role variable to constrain on.
 *       502:
 *         description: The upstream ERDDAP server failed or timed out.
 */

const router = express.Router();
const axios = require("axios");
const db = require("../db");
const cache = require("../utils/cache");
const { pipeline } = require("../utils/routePipeline");
const { ALL_TRAJECTORY_TYPES } = require("../utils/dataTypes");

// A record id goes into ERDDAP as a regex constraint (`=~"..."`), and ERDDAP
// regexes are Java regexes matched against the WHOLE value. Escaping the
// metacharacters therefore turns the constraint back into exact equality, which
// is what the caller means. Unescaped, an id containing '.', '(' or '+' matched
// the wrong rows or made ERDDAP throw.
const REGEX_METACHARACTERS = /[.\\+*?[\]^$(){}|]/g;
const escapeErddapRegex = (value) =>
  String(value).replace(REGEX_METACHARACTERS, "\\$&");

// The destination name ERDDAP gives the T axis. Assumed rather than looked up,
// which is the same assumption the time-window constraint below already makes.
const TIME_COLUMN = "time";

// ERDDAP rejects a regex on a time column outright — it wants an ISO 8601
// literal — and mpoSgdoADCP publishes cf_role=profile_id ON its time column, so
// the step constraint really does land there.
const constraintFor = (column, value) =>
  column === TIME_COLUMN
    ? `${column}=${encodeURIComponent(value)}`
    : `${column}=~${encodeURIComponent(`"${escapeErddapRegex(value)}"`)}`;

// Whether this record holds several profiles to step through. TimeSeriesProfile
// and TrajectoryProfile set both id variables and the record is the outer one,
// so the inner one is the step; a Profile record's own id is both, and a
// TimeSeries has no inner id at all. No branch on cdm_data_type needed.
const steppedRecord = (recordColumn, stepColumn) =>
  Boolean(stepColumn) && stepColumn !== recordColumn;

// How many rows one preview draws. Module level because both handlers bind it
// into FEATURE_SQL, which sizes its time window against it.
const PREVIEW_ROW_LIMIT = 1000;

// Every profile of a record, past this, is more than a slider can address and
// more than is worth sending: mpoSgdoADCP's longest record has 48166 of them,
// which is 3.5 MB of ERDDAP JSON.
const MAX_STEPS = 5000;

// Every k-th profile, with the last one always kept so the slider can still
// reach the end of the record.
function sampleSteps(steps) {
  if (steps.length <= MAX_STEPS) return { steps, truncated: false };
  const stride = Math.ceil(steps.length / MAX_STEPS);
  const sampled = steps.filter((_, index) => index % stride === 0);
  const last = steps[steps.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return { steps: sampled, truncated: true };
}

// Fixed vocabulary, not user input, so it is safe to inline into the SQL — the
// same reasoning tiles.js's trajectoryTypePredicate() relies on.
const TRAJECTORY_TYPES_SQL = ALL_TRAJECTORY_TYPES.map((t) => `'${t}'`).join(
  ",",
);

/*
 * /preview
 *
 * Gets ~1000 rows from an ERDDAP dataset for one record.
 *
 * Records live in one of two places depending on cdm_data_type, which is why
 * this query has two branches rather than one join:
 *
 *   Profile / TimeSeries / TimeSeriesProfile -> cde.profiles
 *   Trajectory / TrajectoryProfile           -> cde.trajectory_track_stats
 *                                               + cde.trajectory_days
 *
 * Trajectories never get a cde.profiles row (the harvester routes their
 * features to trajectory_days instead), so the single-table version of this
 * query returned zero rows and threw for every trajectory record — while
 * shapeQuery.js's trajectory branch happily listed those records in the UI for
 * the user to click.
 */
const FEATURE_SQL = `
WITH ds AS (
  SELECT pk, dataset_id, erddap_url, cdm_data_type, table_variables,
         timeseries_id_variable, profile_id_variable, trajectory_id_variable
  FROM   cde.datasets
  WHERE  dataset_id = :dataset
),
-- One cde.profiles row per record; records_per_day is harvested per profile.
profile_feature AS (
  SELECT p.dataset_pk,
         COALESCE(p.profile_id, p.timeseries_id) AS feature_id,
         p.time_min,
         p.time_max,
         p.n_records,
         p.records_per_day
  FROM   cde.profiles p
  JOIN   ds ON ds.pk = p.dataset_pk
  WHERE  COALESCE(p.profile_id, p.timeseries_id) = :profile
),
-- Time bounds come from the per-track summary (real timestamps); the record
-- count and cadence are summed from the day buckets, the same derivation
-- shapeQuery.js uses for its trajectory branch.
trajectory_feature AS (
  SELECT s.dataset_pk,
         s.trajectory_id AS feature_id,
         s.time_min,
         s.time_max,
         SUM(td.n_records) AS n_records,
         SUM(td.n_records)::double precision
           / GREATEST(COUNT(DISTINCT td.day), 1) AS records_per_day
  FROM   cde.trajectory_track_stats s
  JOIN   ds ON ds.pk = s.dataset_pk
  JOIN   cde.trajectory_days td
         ON  td.dataset_pk    = s.dataset_pk
         AND td.trajectory_id = s.trajectory_id
  WHERE  s.trajectory_id = :profile
  GROUP  BY s.dataset_pk, s.trajectory_id, s.time_min, s.time_max
),
feature AS (
  SELECT * FROM profile_feature
  UNION ALL
  SELECT * FROM trajectory_feature
)
SELECT ds.dataset_id,
       ds.erddap_url,
       ds.cdm_data_type,
       ds.table_variables,
       -- The ERDDAP column to constrain on. A TimeSeriesProfile sets BOTH
       -- timeseries_id_variable and profile_id_variable, and the record shown in
       -- the UI is the station, so timeseries wins. A TrajectoryProfile sets
       -- both trajectory_id_variable and profile_id_variable, and there the
       -- record is the trajectory — so a flat COALESCE over all three would
       -- pick the wrong column. Hence the explicit branch on type.
       CASE WHEN ds.cdm_data_type IN (${TRAJECTORY_TYPES_SQL})
              THEN ds.trajectory_id_variable
              ELSE COALESCE(ds.timeseries_id_variable, ds.profile_id_variable)
       END AS profile_variable,
       -- The per-profile key INSIDE the record. Set and different from
       -- profile_variable exactly for TimeSeriesProfile and TrajectoryProfile,
       -- which is what decides whether a record has profiles to step through;
       -- a Profile record's own id is both, and a TimeSeries has none.
       ds.profile_id_variable AS step_variable,
       f.feature_id AS profile_id,
       f.n_records,
       f.time_max::text  AS time_max,
       win.new_start_time::text AS new_start_time,
       (win.new_start_time IS NULL
         OR win.new_start_time <= f.time_min
         OR f.n_records <= :NUM_RECORDS) AS use_whole_profile
FROM   feature f
JOIN   ds ON ds.pk = f.dataset_pk
CROSS JOIN LATERAL (
  -- Widen back from time_max by however many hours it takes to gather about
  -- NUM_RECORDS rows at this record's own cadence. A cadence of zero (or NULL)
  -- cannot size a window and used to raise a division-by-zero; it now falls
  -- through to "fetch the whole record" instead.
  SELECT CASE WHEN COALESCE(f.records_per_day, 0) > 0
                THEN f.time_max
                     - (interval '1 hour'
                        * CEIL(:NUM_RECORDS / (f.records_per_day / 24)))
         END AS new_start_time
) win
LIMIT 1`;

router.get(
  "/",
  ...pipeline({
    // dataset and profile are the only params this route reads; the shared
    // filter set does not apply to it. Both are bound into the query below, so
    // the caps are about size, not injection.
    filters: false,
    // Cache the good answer, never the failure: this is the one data route that
    // calls ERDDAP live, so an uncached error meant every render re-hit a server
    // that had just failed.
    cacheFor: "5 minutes",
    cacheToggle: cache.onlyOk,
    checks: [check(["dataset", "profile", "at"]).isLength({ max: 256 })],
  }),
  async (req, res, next) => {
    const { dataset, profile, at } = req.query;

    // NOTE: filtered by dataset_id alone, so a dataset_id published on two
    // ERDDAP servers resolves to whichever row sorts first. That ambiguity
    // predates this route taking a `server` param; the frontend only ever sends
    // the id. LIMIT 1 makes the pick explicit rather than accidental.
    const rows = await db.raw(FEATURE_SQL, {
      profile,
      dataset,
      NUM_RECORDS: PREVIEW_ROW_LIMIT,
    });

    if (!rows.rows?.length) {
      // Either the dataset_id is unknown or that record does not belong to it.
      // Both are the caller asking for something that isn't there, not a fault.
      return res
        .status(404)
        .send({ error: "RECORD_NOT_FOUND", dataset, profile });
    }

    const {
      profile_variable,
      step_variable,
      dataset_id,
      cdm_data_type,
      erddap_url,
      profile_id,
      time_max,
      new_start_time,
      use_whole_profile,
      table_variables,
    } = rows.rows[0];

    if (!profile_variable) {
      // No cf_role variable to constrain on: without it the query would read
      // `&null=~"..."` and ERDDAP would reject it. Say so instead.
      return res.status(422).send({
        error: "NO_RECORD_ID_VARIABLE",
        dataset: dataset_id,
        cdm_data_type,
      });
    }

    const constraint = constraintFor(profile_variable, profile_id);
    let erddapQuery = `${erddap_url}/tabledap/${dataset_id}.json?&${constraint}`;
    // `at` names one profile inside the record. The whole point of it is to
    // reach a profile OUTSIDE the tail window below, so the two are exclusive:
    // asking for a 2023 cast and then constraining to the last few hours of the
    // record answers nothing.
    const step =
      at && steppedRecord(profile_variable, step_variable) ? at : null;
    if (step) {
      erddapQuery += `&${constraintFor(step_variable, step)}`;
    } else if (!use_whole_profile) {
      // Including time_max guards against records added since the last harvest.
      erddapQuery += `&time>${new_start_time}&time<${time_max}`;
    }

    console.log("Fetching preview from ", erddapQuery);
    try {
      const { data } = await axios.get(erddapQuery, {
        // A record with no usable cadence falls through to use_whole_profile,
        // and some of those are hundreds of thousands of rows — tens of MB that
        // this route downloads only to slice off the first 1000. Neither bound
        // existed before, so one such record could pin a worker indefinitely.
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024,
      });
      console.log("FOUND ", data.table?.rows?.length, " ROWS", erddapQuery);
      if (!data?.table?.rows?.length) {
        return res
          .status(404)
          .send({ error: "NO_DATA", dataset: dataset_id, profile: profile_id });
      }
      data.table.rows = data.table.rows.slice(0, PREVIEW_ROW_LIMIT);
      // Per-variable metadata (long_name, cf_role, colorBar*, ...) harvested
      // from ERDDAP's /info document. Attached here rather than in
      // shapeQuery.js on purpose: that one feeds /pointQuery, which would then
      // carry ~15 KB per dataset for every dataset in view to serve one modal.
      //
      // ERDDAP's column order is authoritative — the harvest can be older than
      // the dataset, so a column may exist in one and not the other. Indexing
      // by name and emitting null for anything unmatched keeps columnMeta the
      // same length as columnNames, so the frontend can zip them positionally.
      //
      // The key is omitted entirely when the dataset has never been harvested
      // with this column, which is what lets the frontend tell "no metadata"
      // (fall back to column names) from "metadata says nothing about this one".
      if (Array.isArray(table_variables)) {
        const byName = new Map(
          table_variables.map((variable) => [variable.name, variable]),
        );
        data.table.columnMeta = (data.table.columnNames || []).map(
          (name) => byName.get(name) ?? null,
        );
      }
      return res.send(data);
    } catch (error) {
      // ERDDAP answers "no matching results" with a 404, or a 500 whose body
      // says so. That is an empty record, not an outage, and must not be
      // reported as one.
      const status = error.response?.status;
      const body = String(error.response?.data ?? "");
      const isEmpty =
        status === 404 ||
        body.includes("Your query produced no matching results");

      if (isEmpty) {
        return res
          .status(404)
          .send({ error: "NO_DATA", dataset: dataset_id, profile: profile_id });
      }

      // A real upstream failure. Previously this returned `200 []`, so the
      // frontend could not tell it apart from an empty record and Sentry only
      // ever saw a message with no context.
      console.error("Preview upstream failure", status, error.message);
      Sentry.captureException(error, {
        tags: { route: "preview", erddap_status: status ?? "none" },
        extra: { erddapQuery, dataset: dataset_id, profile: profile_id },
      });
      return res.status(502).send({
        error: "ERDDAP_UNAVAILABLE",
        dataset: dataset_id,
        upstreamStatus: status ?? null,
      });
    }
  },
);

/**
 * @swagger
 * /preview/profiles:
 *   get:
 *     summary: The profiles inside one record, for the preview's slider
 *     tags: [Preview]
 *     description: >
 *       A TimeSeriesProfile record is a station holding many casts, and a
 *       TrajectoryProfile record is a track holding many profiles; /preview
 *       returns a 1000-row window of one, which is the tail of the record and
 *       may hold a handful of them. This lists what is there, so the preview can
 *       step to any of them with /preview?at=.
 *
 *       Answers 200 with an empty list for a record that holds exactly one
 *       profile (Profile, TimeSeries, Trajectory) - that is the answer, not a
 *       failure, and the caller draws no slider.
 *     parameters:
 *       - in: query
 *         name: dataset
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: profile
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: >
 *           { column, steps: [{ value, time }], count, truncated }. `count` is
 *           always the true number of profiles; `steps` is every k-th of them
 *           once that passes 5000, with `truncated` saying so.
 *       404:
 *         description: Unknown dataset or unknown record.
 *       422:
 *         description: The dataset declares no CF role variable to constrain on.
 *       502:
 *         description: The upstream ERDDAP server failed or timed out.
 */
router.get(
  "/profiles",
  ...pipeline({
    filters: false,
    // A record's cast list changes only when the dataset is republished, where
    // its rows are a live read — so this one is cached for the default day
    // rather than the row route's five minutes.
    cacheToggle: cache.onlyOk,
    checks: [check(["dataset", "profile"]).isLength({ max: 256 })],
  }),
  async (req, res, next) => {
    const { dataset, profile } = req.query;
    const rows = await db.raw(FEATURE_SQL, {
      profile,
      dataset,
      NUM_RECORDS: PREVIEW_ROW_LIMIT,
    });

    if (!rows.rows?.length) {
      return res
        .status(404)
        .send({ error: "RECORD_NOT_FOUND", dataset, profile });
    }

    const {
      profile_variable,
      step_variable,
      dataset_id,
      cdm_data_type,
      erddap_url,
      profile_id,
    } = rows.rows[0];

    if (!profile_variable) {
      return res.status(422).send({
        error: "NO_RECORD_ID_VARIABLE",
        dataset: dataset_id,
        cdm_data_type,
      });
    }

    const empty = { column: null, steps: [], count: 0, truncated: false };
    if (!steppedRecord(profile_variable, step_variable)) {
      return res.send(empty);
    }

    // `time` as well as the step column, because the slider labels a cast by
    // when it was taken — unless the step column IS time, which is how
    // mpoSgdoADCP identifies its profiles.
    const columns =
      step_variable === TIME_COLUMN
        ? TIME_COLUMN
        : `${step_variable},${TIME_COLUMN}`;
    const erddapQuery =
      `${erddap_url}/tabledap/${dataset_id}.json?${columns}` +
      `&${constraintFor(profile_variable, profile_id)}&distinct()`;

    try {
      const { data } = await axios.get(erddapQuery, {
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024,
      });

      const names = data?.table?.columnNames || [];
      const valueAt = names.indexOf(step_variable);
      const timeAt = names.indexOf(TIME_COLUMN);
      // distinct() is over the PAIR, so a profile whose rows span more than one
      // timestamp comes back more than once. First seen wins, which after the
      // sort below is its earliest.
      const byValue = new Map();
      (data?.table?.rows || []).forEach((row) => {
        const value = valueAt >= 0 ? row[valueAt] : null;
        if (value === null || value === undefined || value === "") return;
        if (byValue.has(value)) return;
        byValue.set(value, { value, time: timeAt >= 0 ? row[timeAt] : null });
      });

      const ordered = [...byValue.values()].sort((left, right) =>
        String(left.time ?? left.value).localeCompare(
          String(right.time ?? right.value),
        ),
      );
      const { steps, truncated } = sampleSteps(ordered);
      return res.send({
        column: step_variable,
        steps,
        count: ordered.length,
        truncated,
      });
    } catch (error) {
      const status = error.response?.status;
      const body = String(error.response?.data ?? "");
      // An empty record has no profiles to step through, which is the same
      // answer as a record that holds one. /preview reports the emptiness.
      if (
        status === 404 ||
        body.includes("Your query produced no matching results")
      ) {
        return res.send(empty);
      }

      console.error("Preview profiles upstream failure", status, error.message);
      Sentry.captureException(error, {
        tags: { route: "preview/profiles", erddap_status: status ?? "none" },
        extra: { erddapQuery, dataset: dataset_id, profile: profile_id },
      });
      return res.status(502).send({
        error: "ERDDAP_UNAVAILABLE",
        dataset: dataset_id,
        upstreamStatus: status ?? null,
      });
    }
  },
);

module.exports = router;
