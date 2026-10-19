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
         p.records_per_day,
         p.profile_id AS cast_id,
         p.timeseries_id AS station_id
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
           / GREATEST(COUNT(DISTINCT td.day), 1) AS records_per_day,
         NULL::text AS cast_id,
         NULL::text AS station_id
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
       -- The per-profile key INSIDE the record. Set and different from
       -- profile_variable exactly for TimeSeriesProfile and TrajectoryProfile,
       -- which is what decides whether a record has profiles to step through;
       -- a Profile record's own id is both, and a TimeSeries has none.
       ds.profile_id_variable AS step_variable,
       -- A TimeSeriesProfile is stored per cast unless a station holds more
       -- than the harvester's cap (timeseries_profile.py), so its record id can
       -- be a cast. The constraint above is on the station, so constrain on the
       -- cast's station and step to the cast itself.
       CASE WHEN cast_record.is_cast THEN f.station_id ELSE f.feature_id END
         AS profile_id,
       CASE WHEN cast_record.is_cast THEN f.cast_id END AS record_step,
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
  SELECT ds.cdm_data_type = 'TimeSeriesProfile'
         AND f.cast_id IS NOT NULL
         AND f.station_id IS NOT NULL AS is_cast
) cast_record
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
      check(["dataset", "profile", "at"]).isLength({ max: 256 }),
      check(["timeMin", "timeMax"]).optional().isISO8601({ strict: true }),
    ],
  }),
  async (req, res, next) => {
    const { dataset, profile, at, timeMin, timeMax } = req.query;

    // NOTE: filtered by dataset_id alone, so a dataset_id published on two
    // ERDDAP servers resolves to whichever row sorts first.
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
      new_start_time,
      use_whole_profile,
      table_variables,
      record_step,
    } = rows.rows[0];

    if (!profile_variable) {
      return res.status(422).send({
        error: "NO_RECORD_ID_VARIABLE",
        dataset: dataset_id,
        cdm_data_type,
      });
    }

    const constraint = constraintFor(profile_variable, profile_id);
    let erddapQuery = `${erddap_url}/tabledap/${dataset_id}.json?&${constraint}`;
    // `at` names one profile inside the record, to reach one OUTSIDE the tail
    // window below, so the two are exclusive. A cast record with no `at` draws
    // its own cast.
    const step = steppedRecord(profile_variable, step_variable)
      ? at || record_step
      : null;
    if (step) {
      erddapQuery += `&${constraintFor(step_variable, step)}`;
    } else if (timeMin || timeMax) {
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
      trimPreviewRows(data.table, PREVIEW_ROW_LIMIT);
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
 *           once that passes 5000, with `truncated` saying so. `current` is
 *           the cast the record itself names (a TimeSeriesProfile harvested
 *           per cast), which /preview draws when no `at` is given; else null.
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
      record_step,
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
        current: record_step ?? null,
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
