const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

const SPARKLINE_DEPTH = 10;

// cde.harvest_attempts is append-only and HarvestDataset.jsx renders every
// history row into an unpaginated table, so the history must be capped.
const HISTORY_MAX_ROWS = 200;

const WARNING_DATASET_SAMPLE = 20;

// A hash-unchanged skip means the dataset was verified up to date, so the
// dataset-centric views count it as a healthy success. Per-run audit views
// deliberately keep the raw 'skipped'.
const NORM_STATUS = (col) =>
  `CASE WHEN ${col}.status = 'skipped' AND ${col}.reason_code = 'UNCHANGED' THEN 'success' ELSE ${col}.status END`;
const NORM_REASON = (col) =>
  `CASE WHEN ${col}.status = 'skipped' AND ${col}.reason_code = 'UNCHANGED' THEN NULL ELSE ${col}.reason_code END`;
const NORM_ERRMSG = (col) =>
  `CASE WHEN ${col}.status = 'skipped' AND ${col}.reason_code = 'UNCHANGED' THEN NULL ELSE ${col}.error_message END`;

function unslug(slug) {
  const padded = slug + "=".repeat((4 - (slug.length % 4)) % 4);
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

// Slugs drop the scheme and replace '.' and '/' with '-' (e.g.
// erddap-ogsl-ca-erddap). Legacy base64 slugs are still honoured so old links
// keep working.
async function resolveErddapUrl(slug) {
  try {
    const decoded = unslug(slug);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* not a base64 slug — fall through to the transform lookup */
  }
  // The transform must match harvest_attempts_slug_idx (1_schema.sql) so the
  // planner can use that index.
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

// Pass null for optional params: the CAST(? AS text) IS NULL pattern in the
// SQL handles them.

async function listServers() {
  // last_success is needed because failed runs are recorded too, so the
  // latest attempt alone can't say when a server last worked.
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
           COUNT(*) AS n_total,
           last_success.finished_at AS last_success_at,
           last_success.run_id      AS last_success_run_id
    FROM latest_run_per_server s
    LEFT JOIN cde.harvest_attempts a
        ON a.erddap_url = s.erddap_url
       AND a.run_id     = s.last_run_id
    LEFT JOIN LATERAL (
        SELECT r.run_id, r.finished_at::timestamptz AS finished_at
        FROM cde.harvest_runs r
        WHERE r.status = 'ok'
          AND EXISTS (
                SELECT 1 FROM cde.harvest_attempts x
                WHERE x.run_id = r.run_id AND x.erddap_url = s.erddap_url
              )
        ORDER BY r.started_at DESC
        LIMIT 1
    ) last_success ON true
    GROUP BY s.erddap_url, s.source, s.last_attempted_at, s.last_run_id,
             last_success.finished_at, last_success.run_id
    ORDER BY s.erddap_url
  `;
  const result = await db.raw(sql);
  return result.rows;
}

async function recentRuns(limit = 20) {
  // Limit the runs before joining attempts: the audit tables are append-only.
  // Unchanged skips are counted apart so an incremental run doesn't read as
  // hundreds of failures.
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

// warnings come from the latest raw 'success' attempt, not the latest attempt:
// an UNCHANGED skip carries none, yet the loaded data is still that harvest's.
async function serverDatasets(
  erddapUrl,
  statusFilter = null,
  q = null,
  warningCode = null,
) {
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
               query_urls
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
           lw.warnings,
           sp.history_statuses,
           sp.history_times,
           ds.content_hash,
           ds.content_hash_reason,
           ds.last_updated_at,
           dataset_is_realtime(ds.coverage_time_max, ds.verified_at,
                               ds.cdm_data_type) AS is_realtime
    FROM latest_attempt la
    LEFT JOIN sparkline   sp USING (erddap_url, dataset_id)
    LEFT JOIN LATERAL (
        SELECT ok.warnings
        FROM cde.harvest_attempts ok
        WHERE ok.erddap_url = la.erddap_url
          AND ok.dataset_id = la.dataset_id
          AND ok.status = 'success'
        ORDER BY ok.attempted_at DESC
        LIMIT 1
    ) lw ON true
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
      AND (
            CAST(? AS text) IS NULL
            OR lw.warnings @> jsonb_build_array(jsonb_build_object('code', CAST(? AS text)))
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
    warningCode,
    warningCode,
  ]);
  return result.rows;
}

async function datasetHistory(erddapUrl, datasetId, limit = HISTORY_MAX_ROWS) {
  // One row over the cap answers "there is more" without a second COUNT.
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
    SELECT content_hash, content_hash_reason, last_updated_at,
           dataset_is_realtime(coverage_time_max, verified_at,
                               cdm_data_type) AS is_realtime
    FROM cde.datasets
    WHERE dataset_id = ?
      AND rtrim(erddap_url, '/') = rtrim(?, '/')
    LIMIT 1
  `;
  const result = await db.raw(sql, [datasetId, erddapUrl]);
  return result.rows[0] || null;
}

async function latestSuccessWarnings(erddapUrl, datasetId) {
  const sql = `
    SELECT ok.warnings
    FROM cde.harvest_attempts ok
    WHERE ok.erddap_url = ?
      AND ok.dataset_id = ?
      AND ok.status = 'success'
    ORDER BY ok.attempted_at DESC
    LIMIT 1
  `;
  const result = await db.raw(sql, [erddapUrl, datasetId]);
  return result.rows[0]?.warnings ?? null;
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

async function warningBreakdown(erddapUrl) {
  const sql = `
    WITH latest_success AS (
        SELECT DISTINCT ON (dataset_id)
               dataset_id, warnings
        FROM cde.harvest_attempts
        WHERE erddap_url = ?
          AND status = 'success'
        ORDER BY dataset_id, attempted_at DESC
    )
    SELECT w ->> 'code' AS code,
           COUNT(DISTINCT ls.dataset_id)::int AS n_datasets,
           SUM(COALESCE((w ->> 'count')::bigint, 1))::int AS total_count,
           (array_agg(DISTINCT ls.dataset_id ORDER BY ls.dataset_id))[1:?] AS dataset_ids
    FROM latest_success ls
    CROSS JOIN LATERAL jsonb_array_elements(ls.warnings) w
    GROUP BY w ->> 'code'
    ORDER BY n_datasets DESC, code
  `;
  const result = await db.raw(sql, [erddapUrl, WARNING_DATASET_SAMPLE]);
  return result.rows;
}

// The catalogue is only as fresh as its stalest source, so the oldest of each
// source's last successful run. Sources no longer in the catalogue are left
// out: their history would pin the date forever. OBIS datasets don't carry
// the attempts' erddap_url, hence the source test.
async function oldestLastHarvest() {
  const sql = `
    SELECT MIN(last_ok) AS oldest_last_harvest
    FROM (
        SELECT MAX(r.finished_at) AS last_ok
        FROM cde.harvest_attempts a
        JOIN cde.harvest_runs r ON r.run_id = a.run_id
        WHERE r.status = 'ok'
          AND (a.source = 'obis'
               OR a.erddap_url IN (SELECT erddap_url FROM cde.datasets))
        GROUP BY a.erddap_url
    ) per_source
  `;
  const result = await db.raw(sql);
  return result.rows[0]?.oldest_last_harvest ?? null;
}

router.get(
  "/freshness",
  ...pipeline({ filters: false, cacheFor: "10 minutes" }),
  async (req, res) => {
    res.json({ oldestLastHarvest: await oldestLastHarvest() });
  },
);

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
    const warning = req.query.warning || null;
    res.json(await serverDatasets(erddapUrl, status, q, warning));
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
    const currentWarnings = await latestSuccessWarnings(
      erddapUrl,
      req.params.datasetId,
    );
    res.json({
      history,
      historyTruncated: truncated,
      historyLimit: HISTORY_MAX_ROWS,
      meta,
      currentWarnings,
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

// Must stay after /runs/recent, or :runId would match "recent".
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

router.get(
  "/warnings/:slug",
  ...pipeline({ filters: false, cacheFor: "2 minutes" }),
  async (req, res) => {
    const erddapUrl = await resolveErddapUrl(req.params.slug);
    res.json(await warningBreakdown(erddapUrl));
  },
);

module.exports = router;
