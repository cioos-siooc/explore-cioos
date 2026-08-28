// Download-job views for the harvest dashboard.
//
// Everything here is derived from cde.download_jobs — no extra tables. The
// downloader already records a per-dataset outcome in the job's erddap_report
// JSON (status, byte counts, the ERDDAP error text when one was caught), so a
// dataset-level view of what users are downloading is a query, not a schema
// change.
//
// NOTE: download_jobs.email is deliberately never selected. The harvest
// dashboard has no authentication at any layer, so exposing it here would
// publish requesters' email addresses.

const express = require('express')

const router = express.Router()
const db = require('../db')
const cache = require('../utils/cache')

const RECENT_JOB_LIMIT = 25

// erddap_report is a text column holding the downloader's JSON result, but it
// is empty for a queued job and holds a stack trace for a job that died before
// the downloader returned. Guard the cast so one bad row can't 500 the route:
// Postgres 13 has no pg_input_is_valid(), so screen on the leading brace.
const REPORT_JSON = col =>
  `CASE WHEN ${col}.erddap_report LIKE '{%' THEN ${col}.erddap_report::jsonb END`

// Datasets that made it into the zip. Anything else was left out, and the
// per-dataset status says why (mirrors _INCLUDED in download_scheduler).
const INCLUDED = `('COMPLETED', 'PARTIAL')`

// ── SQL query helpers ─────────────────────────────────────────────────────────

async function recentJobs(limit = RECENT_JOB_LIMIT) {
  // Limit the jobs BEFORE expanding their reports — download_jobs is
  // append-only, so exploding every historical report to show the latest 25
  // gets slower forever.
  const sql = `
    WITH recent AS (
        SELECT pk, job_id, time, status, time_start, time_complete,
               download_size, downloader_output, erddap_report
        FROM cde.download_jobs
        ORDER BY time DESC
        LIMIT ?
    )
    SELECT j.pk,
           j.job_id,
           j.time,
           j.status,
           EXTRACT(EPOCH FROM (j.time_complete - j.time_start))::int AS duration_s,
           j.download_size,
           NULLIF(j.downloader_output, '') AS error_message,
           COUNT(d.status) FILTER (WHERE d.status IN ${INCLUDED})     AS n_ok,
           COUNT(d.status) FILTER (WHERE d.status = 'FAILED')         AS n_failed,
           COUNT(d.status) FILTER (WHERE d.status = 'EMPTY')          AS n_empty,
           COUNT(d.status) FILTER (WHERE d.status = 'IGNORED')        AS n_ignored,
           COUNT(d.status)                                            AS n_datasets
    FROM recent j
    LEFT JOIN LATERAL (
        SELECT elem->>'status' AS status
        FROM jsonb_array_elements((${REPORT_JSON('j')})->'erddap_report') elem
    ) d ON true
    GROUP BY j.pk, j.job_id, j.time, j.status, j.time_start, j.time_complete,
             j.download_size, j.downloader_output
    ORDER BY j.time DESC
  `
  const result = await db.raw(sql, [limit])
  return result.rows
}

async function datasetOutcomes(statusFilter = null, q = null) {
  // One row per dataset ever requested, ordered so the datasets that fail most
  // sort to the top — that is the actionable end of this table.
  const sql = `
    WITH exploded AS (
        SELECT j.job_id,
               j.time,
               elem->>'dataset_id'                  AS dataset_id,
               elem->>'erddap_url'                  AS erddap_url,
               elem->>'status'                      AS status,
               NULLIF(elem->>'erddap_error', '')    AS erddap_error,
               NULLIF(elem->>'file_size', '')::numeric AS file_size
        FROM cde.download_jobs j,
             LATERAL jsonb_array_elements((${REPORT_JSON('j')})->'erddap_report') elem
    )
    SELECT dataset_id,
           erddap_url,
           COUNT(*)                                          AS n_attempts,
           COUNT(*) FILTER (WHERE status IN ${INCLUDED})      AS n_ok,
           COUNT(*) FILTER (WHERE status = 'FAILED')          AS n_failed,
           COUNT(*) FILTER (WHERE status = 'EMPTY')           AS n_empty,
           COUNT(*) FILTER (WHERE status = 'IGNORED')         AS n_ignored,
           MAX(time)                                          AS last_attempt_at,
           (array_agg(status ORDER BY time DESC))[1]          AS last_status,
           (array_agg(erddap_error ORDER BY time DESC)
              FILTER (WHERE erddap_error IS NOT NULL))[1]     AS last_error,
           (array_agg(job_id ORDER BY time DESC))[1]          AS last_job_id,
           SUM(file_size)                                     AS total_bytes
    FROM exploded
    GROUP BY dataset_id, erddap_url
    HAVING (CAST(? AS text) IS NULL OR (array_agg(status ORDER BY time DESC))[1] = ?)
       AND (
             CAST(? AS text) IS NULL
             OR dataset_id ILIKE '%' || ? || '%'
             OR erddap_url ILIKE '%' || ? || '%'
           )
    ORDER BY
      COUNT(*) FILTER (WHERE status = 'FAILED') DESC,
      COUNT(*) DESC,
      dataset_id
  `
  const result = await db.raw(sql, [statusFilter, statusFilter, q, q, q])
  return result.rows
}

async function jobDetail(jobId) {
  const sql = `
    SELECT pk, job_id, time, status, time_start, time_complete,
           EXTRACT(EPOCH FROM (time_complete - time_start))::int AS duration_s,
           download_size, estimate_size,
           NULLIF(downloader_output, '') AS error_message
    FROM cde.download_jobs
    WHERE job_id = ?
    ORDER BY time DESC
    LIMIT 1
  `
  const result = await db.raw(sql, [jobId])
  return result.rows[0] || null
}

async function jobDatasets(jobId) {
  const sql = `
    SELECT elem->>'dataset_id'                     AS dataset_id,
           elem->>'erddap_url'                     AS erddap_url,
           elem->>'status'                         AS status,
           elem->>'ckan_id'                        AS ckan_id,
           NULLIF(elem->>'erddap_error', '')       AS erddap_error,
           NULLIF(elem->>'file_size', '')::numeric AS file_size,
           NULLIF(elem->>'bytes_downloaded', '')::numeric AS bytes_downloaded,
           (elem->>'no_data')::boolean             AS no_data,
           (elem->>'dataset_limit_hit')::boolean   AS dataset_limit_hit,
           (elem->>'query_limit_hit')::boolean     AS query_limit_hit,
           elem->'download_url_list'               AS download_url_list
    FROM cde.download_jobs j,
         LATERAL jsonb_array_elements((${REPORT_JSON('j')})->'erddap_report') elem
    WHERE j.job_id = ?
    ORDER BY
      CASE elem->>'status'
        WHEN 'FAILED' THEN 0
        WHEN 'IGNORED' THEN 1
        WHEN 'EMPTY' THEN 2
        WHEN 'PARTIAL' THEN 3
        ELSE 4
      END,
      elem->>'dataset_id'
  `
  const result = await db.raw(sql, [jobId])
  return result.rows
}

async function summary() {
  // Headline counters for the dashboard card. 'open' jobs older than a few
  // minutes mean nothing is consuming the queue — that is the state the
  // scheduler being down produces, and it is otherwise invisible.
  const sql = `
    SELECT COUNT(*)                                                       AS n_jobs,
           COUNT(*) FILTER (WHERE status = 'completed')                   AS n_completed,
           COUNT(*) FILTER (WHERE status = 'failed')                      AS n_failed,
           COUNT(*) FILTER (WHERE status = 'open')                        AS n_open,
           COUNT(*) FILTER (WHERE status = 'open'
                              AND time < NOW() - INTERVAL '5 minutes')    AS n_stuck,
           COUNT(*) FILTER (WHERE status = 'downloading'
                              AND time_start < NOW() - INTERVAL '5 minutes') AS n_stalled,
           MAX(time)                                                      AS last_request_at
    FROM cde.download_jobs
  `
  const result = await db.raw(sql)
  return result.rows[0]
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/summary', cache.route('30 seconds'), async (req, res, next) => {
  try {
    res.json(await summary())
  } catch (err) {
    next(err)
  }
})

router.get('/recent', cache.route('30 seconds'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || RECENT_JOB_LIMIT, 200)
    res.json(await recentJobs(limit))
  } catch (err) {
    next(err)
  }
})

router.get('/datasets', cache.route('1 minute'), async (req, res, next) => {
  try {
    res.json(await datasetOutcomes(req.query.status || null, req.query.q || null))
  } catch (err) {
    next(err)
  }
})

// Defined after /summary, /recent and /datasets so those literals aren't
// swallowed by :jobId.
router.get('/:jobId', cache.route('1 minute'), async (req, res, next) => {
  try {
    const job = await jobDetail(req.params.jobId)
    if (!job) return res.status(404).json({ error: 'Download job not found' })
    res.json({ job, datasets: await jobDatasets(req.params.jobId) })
  } catch (err) {
    next(err)
  }
})

module.exports = router
