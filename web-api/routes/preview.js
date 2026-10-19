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
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *         description: >
 *           With timeMax, limits the preview to that period (e.g. one pass of
 *           a trajectory through a selected area) instead of the record's
 *           most recent rows.
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
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
const { trimPreviewRows } = require("../utils/previewRows");

// ERDDAP regex constraints match the whole value, so escaping metacharacters
// turns `=~` back into exact equality.
const REGEX_METACHARACTERS = /[.\\+*?[\]^$(){}|]/g;
const escapeErddapRegex = (value) =>
  String(value).replace(REGEX_METACHARACTERS, "\\$&");

// Fixed vocabulary, not user input, so it is safe to inline into the SQL.
const TRAJECTORY_TYPES_SQL = ALL_TRAJECTORY_TYPES.map((t) => `'${t}'`).join(
  ",",
);

// Trajectories never get a cde.profiles row, hence the two branches.
const FEATURE_SQL = `
WITH ds AS (
  SELECT pk, dataset_id, erddap_url, cdm_data_type, table_variables,
         timeseries_id_variable, profile_id_variable, trajectory_id_variable
  FROM   cde.datasets
  WHERE  dataset_id = :dataset
),
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
       -- TimeSeriesProfile and TrajectoryProfile both also set
       -- profile_id_variable, but the record is the station / trajectory, so a
       -- flat COALESCE over all three would pick the wrong column.
       CASE WHEN ds.cdm_data_type IN (${TRAJECTORY_TYPES_SQL})
              THEN ds.trajectory_id_variable
              ELSE COALESCE(ds.timeseries_id_variable, ds.profile_id_variable)
       END AS profile_variable,
       f.feature_id AS profile_id,
       f.n_records,
       -- Not a text cast, whose space and non-Z offset would go straight
       -- into an ERDDAP URL.
       to_char(win.new_start_time AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS new_start_time,
       (win.new_start_time IS NULL
         OR win.new_start_time <= f.time_min
         OR f.n_records <= :NUM_RECORDS) AS use_whole_profile
FROM   feature f
JOIN   ds ON ds.pk = f.dataset_pk
CROSS JOIN LATERAL (
  -- A zero or NULL cadence cannot size a window; it falls through to
  -- fetching the whole record.
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
    filters: false,
    // Never cache a live-ERDDAP failure.
    cacheFor: "5 minutes",
    cacheToggle: cache.onlyOk,
    checks: [
      check(["dataset", "profile"]).isLength({ max: 256 }),
      check(["timeMin", "timeMax"]).optional().isISO8601({ strict: true }),
    ],
  }),
  async (req, res, next) => {
    const NUM_RECORDS = 1000;
    const { dataset, profile, timeMin, timeMax } = req.query;

    // NOTE: filtered by dataset_id alone, so a dataset_id published on two
    // ERDDAP servers resolves to whichever row sorts first.
    const rows = await db.raw(FEATURE_SQL, { profile, dataset, NUM_RECORDS });

    if (!rows.rows?.length) {
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
      new_start_time,
      use_whole_profile,
      table_variables,
    } = rows.rows[0];

    if (!profile_variable) {
      return res.status(422).send({
        error: "NO_RECORD_ID_VARIABLE",
        dataset: dataset_id,
        cdm_data_type,
      });
    }

    const constraint = `${profile_variable}=~${encodeURIComponent(
      `"${escapeErddapRegex(profile_id)}"`,
    )}`;
    let erddapQuery = `${erddap_url}/tabledap/${dataset_id}.json?&${constraint}`;
    if (timeMin || timeMax) {
      if (timeMin) erddapQuery += `&time>=${new Date(timeMin).toISOString()}`;
      if (timeMax) erddapQuery += `&time<=${new Date(timeMax).toISOString()}`;
    } else if (!use_whole_profile) {
      // Lower bound only, so near-real-time records newer than the last
      // harvest still show. Anchored on this record's own time_max, not the
      // dataset's, whose newest data usually belongs to another record.
      erddapQuery += `&time>${new_start_time}`;
    }

    console.log("Fetching preview from ", erddapQuery);
    try {
      const { data } = await axios.get(erddapQuery, {
        // use_whole_profile records can be tens of MB.
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
      trimPreviewRows(data.table, NUM_RECORDS);
      // Attached here rather than in shapeQuery.js, which would then carry
      // ~15 KB per dataset to /pointQuery. Kept positionally aligned with
      // ERDDAP's columnNames since the harvest may be older than the dataset;
      // omitted entirely when never harvested, so the frontend can tell "no
      // metadata" apart.
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
      // says so: an empty record, not an outage.
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

module.exports = router;
