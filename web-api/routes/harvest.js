const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

const SPARKLINE_DEPTH = 10;

// Cap on the per-dataset attempt history. cde.harvest_attempts is append-only
// and gains a row per dataset per run, so this was the one dashboard query
// whose result grows without bound — and HarvestDataset.jsx renders every row
// it is given into an unpaginated table. Deep enough that the answer the page
// exists to give ("what has this dataset been doing lately") is never cut off;
// the response says when it truncated so the page can admit it rather than
// present a partial history as the whole one.
const HISTORY_MAX_ROWS = 200;

// A hash-unchanged skip (status='skipped', reason_code='UNCHANGED') means the
// dataset was verified as up to date — one HTTP request, nothing re-uploaded.
// In the dataset-centric dashboard views that counts as a healthy "success"
// with no failure reason; the fact that nothing was re-uploaded is conveyed by
// "Last update" lagging "Last check", not by a skipped status. These SQL
// fragments normalise an attempt's status/reason accordingly. (Per-run audit
// views deliberately keep the raw 'skipped' so a run still shows what it did.)
const NORM_STATUS = (col) =>
  `CASE WHEN ${col}.status = 'skipped' AND ${col}.reason_code = 'UNCHANGED' THEN 'success' ELSE ${col}.status END`;
const NORM_REASON = (col) =>
  `CASE WHEN ${col}.status = 'skipped' AND ${col}.reason_code = 'UNCHANGED' THEN NULL ELSE ${col}.reason_code END`;
const NORM_ERRMSG = (col) =>
  `CASE WHEN ${col}.status = 'skipped' AND ${col}.reason_code = 'UNCHANGED' THEN NULL ELSE ${col}.error_message END`;

// ── URL helpers ───────────────────────────────────────────────────────────────

// Server IDs travel in the path as base64url. Only the decode lives here; the
// encode was a dead `slugify()` — the frontend produces these slugs.
function unslug(slug) {
  const padded = slug + "=".repeat((4 - (slug.length % 4)) % 4);
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

// Slugs are a readable form of the source URL: scheme dropped, '.' and '/'
// replaced with '-' (e.g. erddap-ogsl-ca-erddap). Resolve one back to the full
// stored erddap_url by applying the same transform to the stored URLs. Legacy
// base64-encoded slugs (full URLs) are still honoured so old links keep working.
async function resolveErddapUrl(slug) {
  try {
    const decoded = unslug(slug);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* not a base64 slug — fall through to the transform lookup */
  }
  // Matched against the stored URLs by the same transform, which
  // harvest_attempts_slug_idx (1_schema.sql) indexes: as a plain predicate the
  // planner can use that index, whereas the DISTINCT subquery this replaced
  // had to read every row of an append-only table — one full pass per request,
  // on all three routes below, growing with every harvest run.
  // NB: avoid '?' in the regexes — knex treats it as a positional binding.
  const sql = `
    SELECT erddap_url
    FROM cde.harvest_attempts
    WHERE translate(
            regexp_replace(regexp_replace(erddap_url, '^[a-z]+://', '', 'i'), '/+$', ''),
            './', '--'
          ) = ?
    ORDER BY erddap_url
    LIMIT 1
  `;
  const result = await db.raw(sql, [slug]);
  return result.rows[0] ? result.rows[0].erddap_url : slug;
}

// ── SQL query helpers ─────────────────────────────────────────────────────────
// Knex raw uses ? as positional placeholder. Pass null for optional params —
// the CAST(? AS text) IS NULL pattern in the SQL handles them correctly.

async function listServers() {
  // latest_run_per_server is one row per (server, source) describing its most
  // recent attempt. DISTINCT ON over the (erddap_url, dataset_id,
  // attempted_at DESC) index, rather than a GROUP BY carrying a correlated
  // scalar subquery that re-ran a per-server ORDER BY ... LIMIT 1 for every
  // group — the pattern recentRuns below was already restructured away from.
  //
  // That subquery keyed last_run_id on erddap_url alone while the group is
  // (erddap_url, source); each group now takes the run of its own latest
  // attempt. A URL only ever carries one source ('erddap' or 'obis' — OBIS
  // rows use the obis.org sentinel), so the two agree on real data, and the
  // old and new CTEs were diffed on a live database to confirm it.
  //
  // Kept out of the SQL string on purpose: knex substitutes its :name and ?
  // bindings inside `--` comments too, so prose belongs here.
  const sql = `
    WITH latest_run_per_server AS (
        SELECT DISTINCT ON (erddap_url, source)
               erddap_url,
               source,
               attempted_at AS last_attempted_at,
               run_id       AS last_run_id
        FROM cde.harvest_attempts
        ORDER BY erddap_url, source, attempted_at DESC
    )
    SELECT s.erddap_url,
           s.source,
           s.last_attempted_at,
           s.last_run_id,
           COUNT(*) FILTER (WHERE ${NORM_STATUS("a")} = 'success') AS n_success,
           COUNT(*) FILTER (WHERE ${NORM_STATUS("a")} = 'skipped') AS n_skipped,
           COUNT(*) FILTER (WHERE a.status = 'error')   AS n_error,
           COUNT(*) AS n_total
    FROM latest_run_per_server s
    LEFT JOIN cde.harvest_attempts a
        ON a.erddap_url = s.erddap_url
       AND a.run_id     = s.last_run_id
    GROUP BY s.erddap_url, s.source, s.last_attempted_at, s.last_run_id
    ORDER BY s.erddap_url
  `;
  const result = await db.raw(sql);
  return result.rows;
}

async function recentRuns(limit = 20) {
  // Limit the runs BEFORE joining attempts — the audit tables are append-only,
  // so aggregating every historical attempt just to show the latest 20 runs
  // gets slower forever. Unchanged (hash-verified) skips are counted apart from
  // real skips so an incremental run doesn't read as hundreds of failures.
  const sql = `
    WITH recent AS (
        SELECT run_id, started_at, finished_at, git_sha, status, error_message,
               scope, triggered_source, triggered_by
        FROM cde.harvest_runs
        ORDER BY started_at DESC
        LIMIT ?
    )
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
           COUNT(a.*) FILTER (WHERE a.status = 'skipped'
                                AND a.reason_code = 'UNCHANGED') AS n_unchanged,
           COUNT(a.*) FILTER (WHERE a.status = 'skipped'
                                AND a.reason_code IS DISTINCT FROM 'UNCHANGED') AS n_skipped,
           COUNT(a.*) FILTER (WHERE a.status = 'error')   AS n_error,
           COUNT(a.*) AS n_total
    FROM recent r
    LEFT JOIN cde.harvest_attempts a USING (run_id)
    GROUP BY r.run_id, r.started_at, r.finished_at, r.git_sha,
             r.status, r.error_message, r.scope, r.triggered_source, r.triggered_by
    ORDER BY r.started_at DESC
  `;
  const result = await db.raw(sql, [limit]);
  return result.rows;
}

async function serverDatasets(erddapUrl, statusFilter = null, q = null) {
  const sql = `
    WITH latest_attempt AS (
        SELECT DISTINCT ON (erddap_url, dataset_id)
               erddap_url,
               dataset_id,
               source,
               ${NORM_STATUS("ha")} AS status,
               ${NORM_REASON("ha")} AS reason_code,
               ${NORM_ERRMSG("ha")} AS error_message,
               duration_ms,
               attempted_at,
               run_id,
               query_urls,
               warnings
        FROM cde.harvest_attempts ha
        WHERE erddap_url = ?
        ORDER BY erddap_url, dataset_id, attempted_at DESC
    ),
    sparkline AS (
        SELECT erddap_url,
               dataset_id,
               array_agg(status ORDER BY attempted_at DESC) AS history_statuses,
               array_agg(attempted_at ORDER BY attempted_at DESC) AS history_times
        FROM (
            SELECT erddap_url, dataset_id,
                   ${NORM_STATUS("ha")} AS status,
                   attempted_at,
                   ROW_NUMBER() OVER (PARTITION BY erddap_url, dataset_id
                                      ORDER BY attempted_at DESC) AS rn
            FROM cde.harvest_attempts ha
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
           la.warnings,
           sp.history_statuses,
           sp.history_times,
           ds.content_hash,
           ds.content_hash_reason,
           ds.last_updated_at
    FROM latest_attempt la
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
  `;
  const result = await db.raw(sql, [
    erddapUrl,
    erddapUrl,
    SPARKLINE_DEPTH,
    statusFilter,
    statusFilter,
    q,
    q,
    q,
    q,
  ]);
  return result.rows;
}

async function datasetHistory(erddapUrl, datasetId, limit = HISTORY_MAX_ROWS) {
  // One row over the cap, so "there is more" is answered by the same query
  // rather than by a second COUNT over the same append-only table.
  const sql = `
    SELECT a.run_id,
           a.attempted_at,
           ${NORM_STATUS("a")} AS status,
           ${NORM_REASON("a")} AS reason_code,
           ${NORM_ERRMSG("a")} AS error_message,
           a.duration_ms,
           a.source,
           a.query_urls,
           a.warnings,
           r.git_sha,
           r.started_at AS run_started_at
    FROM cde.harvest_attempts a
    LEFT JOIN cde.harvest_runs r USING (run_id)
    WHERE a.erddap_url = ?
      AND a.dataset_id = ?
    ORDER BY a.attempted_at DESC
    LIMIT ?
  `;
  const result = await db.raw(sql, [erddapUrl, datasetId, limit + 1]);
  const truncated = result.rows.length > limit;
  return { rows: result.rows.slice(0, limit), truncated };
}

async function datasetMeta(erddapUrl, datasetId) {
  const sql = `
    SELECT content_hash, content_hash_reason, last_updated_at
    FROM cde.datasets
    WHERE dataset_id = ?
      AND rtrim(erddap_url, '/') = rtrim(?, '/')
    LIMIT 1
  `;
  const result = await db.raw(sql, [datasetId, erddapUrl]);
  return result.rows[0] || null;
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
  `;
  const result = await db.raw(sql, [runId]);
  return result.rows[0] || null;
}

async function runAttempts(runId) {
  const sql = `
    SELECT erddap_url, dataset_id, source, status, reason_code,
           error_message, duration_ms, attempted_at, query_urls
    FROM cde.harvest_attempts
    WHERE run_id = ?
    ORDER BY
      erddap_url,
      CASE WHEN status = 'error' THEN 0
           WHEN status = 'skipped' AND reason_code IS DISTINCT FROM 'UNCHANGED' THEN 1
           WHEN status = 'skipped' THEN 2
           ELSE 3 END,
      dataset_id
  `;
  const result = await db.raw(sql, [runId]);
  return result.rows;
}

async function reasonBreakdown(erddapUrl = null) {
  const sql = `
    WITH latest_attempt AS (
        SELECT DISTINCT ON (erddap_url, dataset_id)
               erddap_url, dataset_id,
               ${NORM_STATUS("ha")} AS status,
               ${NORM_REASON("ha")} AS reason_code
        FROM cde.harvest_attempts ha
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
  `;
  const result = await db.raw(sql, [erddapUrl, erddapUrl]);
  return result.rows;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get(
  "/servers",
  ...pipeline({ filters: false, cacheFor: "2 minutes" }),
  async (req, res) => {
    res.json(await listServers());
  },
);

router.get(
  "/servers/:slug",
  ...pipeline({ filters: false, cacheFor: "30 seconds" }),
  async (req, res) => {
    const erddapUrl = await resolveErddapUrl(req.params.slug);
    const status = req.query.status || null;
    const q = req.query.q || null;
    res.json(await serverDatasets(erddapUrl, status, q));
  },
);

router.get(
  "/dataset/:slug/:datasetId",
  ...pipeline({ filters: false, cacheFor: "1 minute" }),
  async (req, res) => {
    const erddapUrl = await resolveErddapUrl(req.params.slug);
    const { rows: history, truncated } = await datasetHistory(
      erddapUrl,
      req.params.datasetId,
    );
    if (!history.length)
      return res.status(404).json({ error: "No harvest history found" });
    const meta = await datasetMeta(erddapUrl, req.params.datasetId);
    res.json({
      history,
      // Present so the page can say it is showing the most recent N rather
      // than implying these are all the attempts there have ever been.
      historyTruncated: truncated,
      historyLimit: HISTORY_MAX_ROWS,
      meta,
      erddap_url: erddapUrl,
    });
  },
);

router.get(
  "/runs/recent",
  ...pipeline({ filters: false, cacheFor: "1 minute" }),
  async (req, res) => {
    res.json(await recentRuns());
  },
);

// Note: /runs/recent must be defined before /runs/:runId to avoid :runId
// matching the literal string "recent".
router.get(
  "/runs/:runId",
  ...pipeline({ filters: false, cacheFor: "1 minute" }),
  async (req, res) => {
    const run = await runDetail(req.params.runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const attempts = await runAttempts(req.params.runId);
    res.json({ run, attempts });
  },
);

router.get(
  "/reasons",
  ...pipeline({ filters: false, cacheFor: "2 minutes" }),
  async (req, res) => {
    res.json(await reasonBreakdown());
  },
);

router.get(
  "/reasons/:slug",
  ...pipeline({ filters: false, cacheFor: "2 minutes" }),
  async (req, res) => {
    const erddapUrl = await resolveErddapUrl(req.params.slug);
    res.json(await reasonBreakdown(erddapUrl));
  },
);

module.exports = router;
