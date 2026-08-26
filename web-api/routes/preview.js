const express = require("express");
// helps with async error handling in express < v5
require("express-async-errors");
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
 *         description: Preview data from ERDDAP in tabledap JSON format.
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
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const { ALL_TRAJECTORY_TYPES } = require("../utils/datasetTypes");

// A record id goes into ERDDAP as a regex constraint (`=~"..."`), and ERDDAP
// regexes are Java regexes matched against the WHOLE value. Escaping the
// metacharacters therefore turns the constraint back into exact equality, which
// is what the caller means. Unescaped, an id containing '.', '(' or '+' matched
// the wrong rows or made ERDDAP throw.
const REGEX_METACHARACTERS = /[.\\+*?[\]^$(){}|]/g;
const escapeErddapRegex = (value) =>
  String(value).replace(REGEX_METACHARACTERS, "\\$&");

// Fixed vocabulary, not user input, so it is safe to inline into the SQL — the
// same reasoning tiles.js's trajectoryTypePredicate() relies on.
const TRAJECTORY_TYPES_SQL = ALL_TRAJECTORY_TYPES.map((t) => `'${t}'`).join(",");

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
  SELECT pk, dataset_id, erddap_url, cdm_data_type,
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
  validatorMiddleware(),
  // Cache the good answer, never the failure: this is the one data route that
  // calls ERDDAP live, so an uncached error meant every render re-hit a server
  // that had just failed.
  cache.route("5 minutes", cache.onlyOk),
  async (req, res, next) => {
    const NUM_RECORDS = 1000;
    const { dataset, profile } = req.query;

    // NOTE: filtered by dataset_id alone, so a dataset_id published on two
    // ERDDAP servers resolves to whichever row sorts first. That ambiguity
    // predates this route taking a `server` param; the frontend only ever sends
    // the id. LIMIT 1 makes the pick explicit rather than accidental.
    const rows = await db.raw(FEATURE_SQL, { profile, dataset, NUM_RECORDS });

    if (!rows.rows?.length) {
      // Either the dataset_id is unknown or that record does not belong to it.
      // Both are the caller asking for something that isn't there, not a fault.
      return res
        .status(404)
        .send({ error: "RECORD_NOT_FOUND", dataset, profile });
    }

    const {
      profile_variable,
      dataset_id,
      cdm_data_type,
      erddap_url,
      profile_id,
      time_max,
      new_start_time,
      use_whole_profile,
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

    const constraint = `${profile_variable}=~${encodeURIComponent(
      `"${escapeErddapRegex(profile_id)}"`
    )}`;
    let erddapQuery = `${erddap_url}/tabledap/${dataset_id}.json?&${constraint}`;
    if (!use_whole_profile) {
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
      data.table.rows = data.table.rows.slice(0, NUM_RECORDS);
      return res.send(data);
    } catch (error) {
      // ERDDAP answers "no matching results" with a 404, or a 500 whose body
      // says so. That is an empty record, not an outage, and must not be
      // reported as one.
      const status = error.response?.status;
      const body = String(error.response?.data ?? "");
      const isEmpty =
        status === 404 || body.includes("Your query produced no matching results");

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
  }
);

module.exports = router;
