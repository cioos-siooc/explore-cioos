const express = require('express')

const router = express.Router()
const db = require('../db')
const cache = require('../utils/cache')

const SPARKLINE_DEPTH = 10

// ── URL helpers ───────────────────────────────────────────────────────────────

function slugify(url) {
  return Buffer.from(url, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function unslug(slug) {
  const padded = slug + '='.repeat((4 - (slug.length % 4)) % 4)
  return Buffer.from(
    padded.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8')
}

// ── SQL query helpers ─────────────────────────────────────────────────────────
// Knex raw uses ? as positional placeholder. Pass null for optional params —
// the CAST(? AS text) IS NULL pattern in the SQL handles them correctly.

async function listServers() {
  const sql = `
    WITH latest_run_per_server AS (
        SELECT erddap_url,
               source,
               MAX(attempted_at) AS last_attempted_at,
               (
                   SELECT run_id
                   FROM cde.harvest_attempts ha2
                   WHERE ha2.erddap_url = ha1.erddap_url
                   ORDER BY attempted_at DESC
                   LIMIT 1
               ) AS last_run_id
        FROM cde.harvest_attempts ha1
        GROUP BY erddap_url, source
    )
    SELECT s.erddap_url,
           s.source,
           s.last_attempted_at,
           s.last_run_id,
           COUNT(*) FILTER (WHERE a.status = 'success') AS n_success,
           COUNT(*) FILTER (WHERE a.status = 'skipped') AS n_skipped,
           COUNT(*) FILTER (WHERE a.status = 'error')   AS n_error,
           COUNT(*) AS n_total
    FROM latest_run_per_server s
    LEFT JOIN cde.harvest_attempts a
        ON a.erddap_url = s.erddap_url
       AND a.run_id     = s.last_run_id
    GROUP BY s.erddap_url, s.source, s.last_attempted_at, s.last_run_id
    ORDER BY s.erddap_url
  `
  const result = await db.raw(sql)
  return result.rows
}

async function recentRuns(limit = 20) {
  const sql = `
    SELECT r.run_id,
           r.started_at,
           r.finished_at,
           r.git_sha,
           r.status,
           r.error_message,
           r.scope,
           r.triggered_source,
           r.triggered_by,
           EXTRACT(EPOCH FROM (r.finished_at::timestamptz - r.started_at::timestamptz))::int AS duration_s,
           COUNT(a.*) FILTER (WHERE a.status = 'success') AS n_success,
           COUNT(a.*) FILTER (WHERE a.status = 'skipped') AS n_skipped,
           COUNT(a.*) FILTER (WHERE a.status = 'error')   AS n_error,
           COUNT(a.*) AS n_total
    FROM cde.harvest_runs r
    LEFT JOIN cde.harvest_attempts a USING (run_id)
    GROUP BY r.run_id, r.started_at, r.finished_at, r.git_sha,
             r.status, r.error_message, r.scope, r.triggered_source, r.triggered_by
    ORDER BY r.started_at DESC
    LIMIT ?
  `
  const result = await db.raw(sql, [limit])
  return result.rows
}

async function serverDatasets(erddapUrl, statusFilter = null, q = null) {
  const sql = `
    WITH latest_attempt AS (
        SELECT DISTINCT ON (erddap_url, dataset_id)
               erddap_url,
               dataset_id,
               source,
               status,
               reason_code,
               error_message,
               duration_ms,
               attempted_at,
               run_id,
               query_urls
        FROM cde.harvest_attempts
        WHERE erddap_url = ?
        ORDER BY erddap_url, dataset_id, attempted_at DESC
    ),
    last_success AS (
        SELECT erddap_url, dataset_id, MAX(attempted_at) AS last_success_at
        FROM cde.harvest_attempts
        WHERE erddap_url = ? AND status = 'success'
        GROUP BY erddap_url, dataset_id
    ),
    sparkline AS (
        SELECT erddap_url,
               dataset_id,
               array_agg(status ORDER BY attempted_at DESC) AS history_statuses,
               array_agg(attempted_at ORDER BY attempted_at DESC) AS history_times
        FROM (
            SELECT erddap_url, dataset_id, status, attempted_at,
                   ROW_NUMBER() OVER (PARTITION BY erddap_url, dataset_id
                                      ORDER BY attempted_at DESC) AS rn
            FROM cde.harvest_attempts
            WHERE erddap_url = ?
        ) ranked
        WHERE rn <= ?
        GROUP BY erddap_url, dataset_id
    )
    SELECT la.erddap_url,
           la.dataset_id,
           la.source,
           la.status,
           la.reason_code,
           la.error_message,
           la.duration_ms,
           la.attempted_at,
           la.run_id,
           la.query_urls,
           ls.last_success_at,
           sp.history_statuses,
           sp.history_times,
           ds.content_hash,
           ds.last_updated_at,
           ds.verified_at
    FROM latest_attempt la
    LEFT JOIN last_success ls USING (erddap_url, dataset_id)
    LEFT JOIN sparkline   sp USING (erddap_url, dataset_id)
    LEFT JOIN cde.datasets ds
        ON ds.dataset_id = la.dataset_id
       AND rtrim(ds.erddap_url, '/') = rtrim(la.erddap_url, '/')
    WHERE (CAST(? AS text) IS NULL OR la.status = ?)
      AND (
            CAST(? AS text) IS NULL
            OR la.dataset_id     ILIKE '%' || ? || '%'
            OR la.reason_code    ILIKE '%' || ? || '%'
            OR la.error_message  ILIKE '%' || ? || '%'
          )
    ORDER BY
      CASE la.status WHEN 'error' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
      la.dataset_id
  `
  const result = await db.raw(sql, [
    erddapUrl, erddapUrl, erddapUrl, SPARKLINE_DEPTH,
    statusFilter, statusFilter,
    q, q, q, q,
  ])
  return result.rows
}

async function datasetHistory(erddapUrl, datasetId) {
  const sql = `
    SELECT a.run_id,
           a.attempted_at,
           a.status,
           a.reason_code,
           a.error_message,
           a.duration_ms,
           a.source,
           a.query_urls,
           r.git_sha,
           r.started_at AS run_started_at
    FROM cde.harvest_attempts a
    LEFT JOIN cde.harvest_runs r USING (run_id)
    WHERE a.erddap_url = ?
      AND a.dataset_id = ?
    ORDER BY a.attempted_at DESC
  `
  const result = await db.raw(sql, [erddapUrl, datasetId])
  return result.rows
}

async function datasetMeta(erddapUrl, datasetId) {
  const sql = `
    SELECT content_hash, last_updated_at, verified_at
    FROM cde.datasets
    WHERE dataset_id = ?
      AND rtrim(erddap_url, '/') = rtrim(?, '/')
    LIMIT 1
  `
  const result = await db.raw(sql, [datasetId, erddapUrl])
  return result.rows[0] || null
}

async function runDetail(runId) {
  const sql = `
    SELECT r.run_id,
           r.started_at::timestamptz  AS started_at,
           r.finished_at::timestamptz AS finished_at,
           r.git_sha,
           r.status,
           r.error_message,
           r.prefect_flow_run_id,
           r.scope,
           r.triggered_source,
           r.triggered_by,
           EXTRACT(EPOCH FROM (r.finished_at::timestamptz - r.started_at::timestamptz))::int AS duration_s
    FROM cde.harvest_runs r
    WHERE r.run_id = ?
  `
  const result = await db.raw(sql, [runId])
  return result.rows[0] || null
}

async function runAttempts(runId) {
  const sql = `
    SELECT erddap_url, dataset_id, source, status, reason_code,
           error_message, duration_ms, attempted_at, query_urls
    FROM cde.harvest_attempts
    WHERE run_id = ?
    ORDER BY
      erddap_url,
      CASE status WHEN 'error' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
      dataset_id
  `
  const result = await db.raw(sql, [runId])
  return result.rows
}

async function reasonBreakdown(erddapUrl = null) {
  const sql = `
    WITH latest_attempt AS (
        SELECT DISTINCT ON (erddap_url, dataset_id)
               erddap_url, dataset_id, status, reason_code
        FROM cde.harvest_attempts
        WHERE (CAST(? AS text) IS NULL OR erddap_url = ?)
        ORDER BY erddap_url, dataset_id, attempted_at DESC
    )
    SELECT reason_code,
           COUNT(*) AS n
    FROM latest_attempt
    WHERE status <> 'success'
      AND reason_code IS NOT NULL
    GROUP BY reason_code
    ORDER BY n DESC
  `
  const result = await db.raw(sql, [erddapUrl, erddapUrl])
  return result.rows
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/servers', cache.route('2 minutes'), async (req, res, next) => {
  try {
    res.json(await listServers())
  } catch (err) {
    next(err)
  }
})

router.get('/servers/:slug', cache.route('30 seconds'), async (req, res, next) => {
  try {
    const erddapUrl = unslug(req.params.slug)
    const status = req.query.status || null
    const q = req.query.q || null
    res.json(await serverDatasets(erddapUrl, status, q))
  } catch (err) {
    next(err)
  }
})

router.get('/dataset/:slug/:datasetId', cache.route('1 minute'), async (req, res, next) => {
  try {
    const erddapUrl = unslug(req.params.slug)
    const history = await datasetHistory(erddapUrl, req.params.datasetId)
    if (!history.length) return res.status(404).json({ error: 'No harvest history found' })
    const meta = await datasetMeta(erddapUrl, req.params.datasetId)
    res.json({ history, meta })
  } catch (err) {
    next(err)
  }
})

router.get('/runs/recent', cache.route('1 minute'), async (req, res, next) => {
  try {
    res.json(await recentRuns())
  } catch (err) {
    next(err)
  }
})

// Note: /runs/recent must be defined before /runs/:runId to avoid :runId
// matching the literal string "recent".
router.get('/runs/:runId', cache.route('1 minute'), async (req, res, next) => {
  try {
    const run = await runDetail(req.params.runId)
    if (!run) return res.status(404).json({ error: 'Run not found' })
    const attempts = await runAttempts(req.params.runId)
    res.json({ run, attempts })
  } catch (err) {
    next(err)
  }
})

router.get('/reasons', cache.route('2 minutes'), async (req, res, next) => {
  try {
    res.json(await reasonBreakdown())
  } catch (err) {
    next(err)
  }
})

router.get('/reasons/:slug', cache.route('2 minutes'), async (req, res, next) => {
  try {
    const erddapUrl = unslug(req.params.slug)
    res.json(await reasonBreakdown(erddapUrl))
  } catch (err) {
    next(err)
  }
})

module.exports = router
