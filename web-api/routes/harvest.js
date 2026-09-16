const express = require("express");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");
const { CKAN_URL } = require("../utils/ckan");

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

// ── Coverage: metadata (CKAN) vs data sources (ERDDAP, OBIS) ─────────────────
// The rest of this file reports what the harvester DID. These routes report
// what it did not: datasets a source advertises that the app does not serve,
// and datasets the app serves that the metadata catalogue has no record of.
//
// Three sets feed every query below:
//   advertised — the latest attempt per (server, dataset) in cde.harvest_attempts.
//                Every dataset an ERDDAP server publishes gets a row each run
//                (including ones rejected before any HTTP request), so this IS
//                the ERDDAP inventory. For OBIS it is the discovered list.
//   app        — cde.datasets, i.e. what CDE actually serves.
//   ckan       — cde.ckan_records, the catalogue snapshot from the last run
//                that fetched one.
//
// erddap_url is rtrim'd on every side: harvest_config URLs carry a trailing
// slash, the URLs parsed out of CKAN resources do not, and cde.datasets holds
// whichever the harvester was given.
const COVERAGE_MAX_ROWS = 500;

// Shared CTE header. `advertised` does its DISTINCT ON over the raw column so
// the (erddap_url, dataset_id, attempted_at DESC) index still applies; the
// rtrim happens in the projections that join on it.
const COVERAGE_CTES = `
    WITH advertised AS (
        SELECT DISTINCT ON (erddap_url, dataset_id)
               rtrim(erddap_url, '/') AS erddap_url,
               dataset_id,
               source,
               ${NORM_STATUS("ha")} AS status,
               ${NORM_REASON("ha")} AS reason_code,
               attempted_at
        FROM cde.harvest_attempts ha
        ORDER BY erddap_url, dataset_id, attempted_at DESC
    ),
    app AS (
        SELECT rtrim(erddap_url, '/') AS erddap_url,
               dataset_id, source_type, ckan_id, title
        FROM cde.datasets
    ),
    ckan AS (
        SELECT ckan_id, ckan_name, title, title_fr, n_resources, snapshot_at,
               obis_dataset_id,
               rtrim(erddap_url, '/') AS erddap_url,
               dataset_id
        FROM cde.ckan_records
    ),
    erddap_advertised AS (
        SELECT erddap_url, dataset_id, status, reason_code, attempted_at
        FROM advertised WHERE source <> 'obis'
    ),
    app_erddap AS (
        -- IS DISTINCT FROM, not <>: source_type is nullable and real databases
        -- carry NULL on ERDDAP rows (it arrives via a concat with the OBIS
        -- frame, which is the only side that sets it). A plain <> yields NULL
        -- for those, dropping every ERDDAP dataset out of this CTE and
        -- reporting the whole catalogue as missing from CDE. Matches the form
        -- routes/erddapServers.js already uses.
        SELECT erddap_url, dataset_id, title
        FROM app WHERE source_type IS DISTINCT FROM 'obis'
    ),
    ckan_erddap AS (
        SELECT DISTINCT erddap_url, dataset_id FROM ckan WHERE erddap_url IS NOT NULL
    ),
    -- One CKAN record per (server, dataset), for joins that only want a label.
    -- Several records can describe the same ERDDAP dataset; joining the raw
    -- ckan set fanned a dataset out into one row per record, so a list showed
    -- 113 rows under a count that said 94. (No backticks in here: this string
    -- is a JS template literal.)
    ckan_erddap_one AS (
        SELECT DISTINCT ON (erddap_url, dataset_id)
               erddap_url, dataset_id, ckan_id, ckan_name, title
        FROM ckan
        WHERE erddap_url IS NOT NULL
        ORDER BY erddap_url, dataset_id, ckan_id
    )
`;

async function coverageSummary() {
  const sql = `
    ${COVERAGE_CTES}
    SELECT
      (SELECT count(*) FROM app)                                     AS n_app_total,
      (SELECT count(*) FROM app
        WHERE source_type IS DISTINCT FROM 'obis')                   AS n_app_erddap,
      (SELECT count(*) FROM app WHERE source_type =  'obis')         AS n_app_obis,
      (SELECT count(DISTINCT ckan_id) FROM ckan)                     AS n_ckan_records,
      (SELECT count(*) FROM ckan_erddap)                             AS n_ckan_erddap_links,
      (SELECT count(DISTINCT obis_dataset_id) FROM ckan
        WHERE obis_dataset_id IS NOT NULL)                           AS n_ckan_obis_links,
      (SELECT max(snapshot_at) FROM ckan)                            AS ckan_snapshot_at,
      (SELECT count(*) FROM erddap_advertised)                       AS n_erddap_advertised,
      (SELECT count(*) FROM erddap_advertised e
        WHERE NOT EXISTS (SELECT 1 FROM app_erddap a
                           WHERE a.erddap_url = e.erddap_url
                             AND a.dataset_id = e.dataset_id))       AS n_erddap_not_in_app,
      (SELECT count(*) FROM ckan c
        WHERE c.erddap_url IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM app_erddap a
                           WHERE a.erddap_url = c.erddap_url
                             AND a.dataset_id = c.dataset_id))       AS n_ckan_not_in_app,
      (SELECT count(*) FROM app_erddap a
        WHERE NOT EXISTS (SELECT 1 FROM ckan_erddap c
                           WHERE c.erddap_url = a.erddap_url
                             AND c.dataset_id = a.dataset_id))       AS n_app_without_ckan,
      (SELECT count(DISTINCT ckan_id) FROM ckan
        WHERE erddap_url IS NULL AND obis_dataset_id IS NULL)        AS n_ckan_no_data_source,
      -- Datasets CKAN describes that NO configured source advertises and CDE
      -- does not serve. Disjoint from n_erddap_not_in_app / n_obis_not_harvested
      -- by construction (both of those require the dataset to be advertised),
      -- so the integration chart can add the three without double counting —
      -- which a naive "records not integrated" figure would, since a CKAN
      -- record pointing at a failed harvest names a dataset already counted.
      -- Counted as DATASETS, not records: several records can name one dataset.
      (SELECT count(*) FROM (
          SELECT DISTINCT c.erddap_url AS a, c.dataset_id AS b
          FROM ckan c
          WHERE c.erddap_url IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM erddap_advertised e
                             WHERE e.erddap_url = c.erddap_url
                               AND e.dataset_id = c.dataset_id)
            AND NOT EXISTS (SELECT 1 FROM app_erddap ap
                             WHERE ap.erddap_url = c.erddap_url
                               AND ap.dataset_id = c.dataset_id)
          UNION
          SELECT DISTINCT NULL AS a, c.obis_dataset_id AS b
          FROM ckan c
          WHERE c.obis_dataset_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM advertised adv
                             WHERE adv.source = 'obis'
                               AND adv.dataset_id = c.obis_dataset_id)
            AND NOT EXISTS (SELECT 1 FROM app ap
                             WHERE ap.source_type = 'obis'
                               AND ap.dataset_id = c.obis_dataset_id)
       ) q)                                                          AS n_ckan_only_datasets,
      -- Records, not links: one served link is enough to call a record
      -- integrated, so this cannot be a sum of the narrower buckets.
      (SELECT count(*) FROM (
          SELECT c.ckan_id
          FROM ckan c
          GROUP BY c.ckan_id
          HAVING bool_or(
            CASE
              WHEN c.erddap_url IS NOT NULL THEN EXISTS (
                     SELECT 1 FROM app_erddap a
                      WHERE a.erddap_url = c.erddap_url
                        AND a.dataset_id = c.dataset_id)
              WHEN c.obis_dataset_id IS NOT NULL THEN EXISTS (
                     SELECT 1 FROM app a
                      WHERE a.source_type = 'obis'
                        AND a.dataset_id = c.obis_dataset_id)
              ELSE false
            END) = false
       ) q)                                                          AS n_ckan_not_integrated,
      (SELECT count(*) FROM app o
        WHERE o.source_type = 'obis'
          AND NOT EXISTS (SELECT 1 FROM ckan c
                           WHERE c.obis_dataset_id = o.dataset_id))  AS n_obis_without_ckan,
      -- OBIS datasets discovery advertised that CDE does not serve. The
      -- integration chart needs both halves of each source to sum to that
      -- source's universe; the ERDDAP half is n_erddap_not_in_app above.
      (SELECT count(*) FROM advertised adv
        WHERE adv.source = 'obis'
          AND NOT EXISTS (SELECT 1 FROM app a
                           WHERE a.source_type = 'obis'
                             AND a.dataset_id = adv.dataset_id))      AS n_obis_not_harvested,
      (SELECT count(DISTINCT c.obis_dataset_id) FROM ckan c
        WHERE c.obis_dataset_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM app a
                           WHERE a.source_type = 'obis'
                             AND a.dataset_id = c.obis_dataset_id))  AS n_obis_not_in_app
  `;
  const result = await db.raw(sql);
  return result.rows[0];
}

// One row per data source: what it advertises, what the app kept, and how much
// of that the catalogue describes. OBIS rows carry the obis.org sentinel as
// their erddap_url, exactly as they do in harvest_attempts and cde.datasets.
async function coverageSources() {
  const sql = `
    ${COVERAGE_CTES}
    SELECT adv.erddap_url,
           adv.source,
           max(adv.attempted_at) AS last_attempted_at,
           count(*) AS n_advertised,
           count(*) FILTER (
             WHERE NOT EXISTS (SELECT 1 FROM app a
                                WHERE a.erddap_url = adv.erddap_url
                                  AND a.dataset_id = adv.dataset_id)
           ) AS n_not_in_app,
           count(*) FILTER (
             WHERE EXISTS (SELECT 1 FROM app a
                            WHERE a.erddap_url = adv.erddap_url
                              AND a.dataset_id = adv.dataset_id)
               AND NOT EXISTS (
                     SELECT 1 FROM ckan c
                      WHERE CASE WHEN adv.source = 'obis'
                                 THEN c.obis_dataset_id = adv.dataset_id
                                 ELSE c.erddap_url = adv.erddap_url
                                  AND c.dataset_id = adv.dataset_id
                            END)
           ) AS n_without_ckan
    FROM advertised adv
    GROUP BY adv.erddap_url, adv.source
    ORDER BY adv.erddap_url
  `;
  const result = await db.raw(sql);
  return result.rows;
}

// Drill-down lists behind the summary counts. Each is keyed by the bucket name
// the route takes, so an unknown name is a 404 rather than an injected table.
// Every query takes the same three bindings — the search term twice, then the
// row cap — so one helper can run any of them. The search matches a concat of
// whichever columns identify a row in that bucket; none of these can use an
// index for ILIKE anyway, so folding them into one haystack costs nothing.
// One row over the cap is fetched, so "there is more" is answered without a
// second COUNT over the same sets.
const COVERAGE_BUCKETS = {
  // Advertised by an ERDDAP server, absent from cde.datasets. reason_code says
  // why the harvester passed on it; NULL means it reported success but the row
  // is gone anyway (pruned, or renamed upstream).
  "erddap-not-in-app": `
    ${COVERAGE_CTES}
    SELECT e.erddap_url,
           e.dataset_id,
           e.status,
           e.reason_code,
           e.attempted_at,
           c.ckan_id,
           c.title
    FROM erddap_advertised e
    LEFT JOIN ckan_erddap_one c
           ON c.erddap_url = e.erddap_url AND c.dataset_id = e.dataset_id
    WHERE NOT EXISTS (SELECT 1 FROM app_erddap a
                       WHERE a.erddap_url = e.erddap_url
                         AND a.dataset_id = e.dataset_id)
      AND (CAST(? AS text) IS NULL
           OR concat_ws(' ', e.dataset_id, e.erddap_url, e.reason_code)
              ILIKE '%' || ? || '%')
    ORDER BY e.erddap_url, e.dataset_id
    LIMIT ?
  `,

  // Every CKAN record with nothing CDE serves behind it — the whole metadata
  // side of the gap in one list, whatever the reason. A record can carry
  // several links, and one served link is enough to call it integrated, so the
  // state is aggregated per record and then one representative link is shown
  // (an ERDDAP link in preference to an OBIS one, then the no-link case).
  "ckan-not-integrated": `
    ${COVERAGE_CTES},
    ckan_rows AS (
        SELECT c.*,
               CASE
                 WHEN c.erddap_url IS NOT NULL THEN EXISTS (
                        SELECT 1 FROM app_erddap a
                         WHERE a.erddap_url = c.erddap_url
                           AND a.dataset_id = c.dataset_id)
                 WHEN c.obis_dataset_id IS NOT NULL THEN EXISTS (
                        SELECT 1 FROM app a
                         WHERE a.source_type = 'obis'
                           AND a.dataset_id = c.obis_dataset_id)
                 ELSE false
               END AS served,
               CASE
                 WHEN c.erddap_url IS NULL AND c.obis_dataset_id IS NULL
                   THEN 'no_data_source'
                 WHEN c.obis_dataset_id IS NOT NULL THEN 'obis_not_served'
                 WHEN EXISTS (SELECT 1 FROM erddap_advertised e
                               WHERE e.erddap_url = c.erddap_url
                                 AND e.dataset_id = c.dataset_id)
                   THEN 'harvest_failed'
                 WHEN EXISTS (SELECT 1 FROM erddap_advertised s
                               WHERE s.erddap_url = c.erddap_url)
                   THEN 'not_advertised'
                 ELSE 'server_not_harvested'
               END AS classification,
               CASE WHEN c.erddap_url IS NOT NULL THEN 0
                    WHEN c.obis_dataset_id IS NOT NULL THEN 1
                    ELSE 2 END AS link_rank
        FROM ckan c
    ),
    unserved AS (
        SELECT ckan_id FROM ckan_rows GROUP BY ckan_id HAVING bool_or(served) = false
    ),
    representative AS (
        SELECT DISTINCT ON (r.ckan_id)
               r.ckan_id, r.ckan_name, r.title, r.erddap_url, r.dataset_id,
               r.obis_dataset_id, r.n_resources, r.classification
        FROM ckan_rows r
        JOIN unserved u ON u.ckan_id = r.ckan_id
        ORDER BY r.ckan_id, r.link_rank
    )
    SELECT rep.*, e.reason_code
    FROM representative rep
    LEFT JOIN erddap_advertised e
           ON e.erddap_url = rep.erddap_url AND e.dataset_id = rep.dataset_id
    WHERE (CAST(? AS text) IS NULL
           OR concat_ws(' ', rep.title, rep.ckan_name, rep.dataset_id,
                             rep.erddap_url, rep.obis_dataset_id, rep.classification)
              ILIKE '%' || ? || '%')
    ORDER BY rep.classification, rep.title
    LIMIT ?
  `,

  // CKAN describes an ERDDAP dataset the app does not serve. The three
  // classifications are different problems with different owners: the harvest
  // tried and failed, the server no longer advertises it (delisted or made
  // private), or CDE has never harvested that server at all.
  "ckan-not-in-app": `
    ${COVERAGE_CTES}
    SELECT c.ckan_id,
           c.ckan_name,
           c.title,
           c.erddap_url,
           c.dataset_id,
           e.status,
           e.reason_code,
           CASE
             WHEN e.dataset_id IS NOT NULL THEN 'harvest_failed'
             WHEN EXISTS (SELECT 1 FROM erddap_advertised s
                           WHERE s.erddap_url = c.erddap_url) THEN 'not_advertised'
             ELSE 'server_not_harvested'
           END AS classification
    FROM ckan c
    LEFT JOIN erddap_advertised e
           ON e.erddap_url = c.erddap_url AND e.dataset_id = c.dataset_id
    WHERE c.erddap_url IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM app_erddap a
                       WHERE a.erddap_url = c.erddap_url
                         AND a.dataset_id = c.dataset_id)
      AND (CAST(? AS text) IS NULL
           OR concat_ws(' ', c.dataset_id, c.erddap_url, c.title)
              ILIKE '%' || ? || '%')
    ORDER BY c.erddap_url, c.dataset_id
    LIMIT ?
  `,

  // Served by CDE, with no CKAN record describing it — the metadata gap.
  "app-without-ckan": `
    ${COVERAGE_CTES}
    SELECT a.erddap_url,
           a.dataset_id,
           a.title,
           adv.status,
           adv.attempted_at
    FROM app_erddap a
    LEFT JOIN advertised adv
           ON adv.erddap_url = a.erddap_url AND adv.dataset_id = a.dataset_id
    WHERE NOT EXISTS (SELECT 1 FROM ckan_erddap c
                       WHERE c.erddap_url = a.erddap_url
                         AND c.dataset_id = a.dataset_id)
      AND (CAST(? AS text) IS NULL
           OR concat_ws(' ', a.dataset_id, a.erddap_url, a.title)
              ILIKE '%' || ? || '%')
    ORDER BY a.erddap_url, a.dataset_id
    LIMIT ?
  `,

  // A CKAN record pointing at neither a tabledap resource nor an OBIS UUID:
  // metadata with nothing behind it that CDE knows how to read.
  "ckan-no-data-source": `
    ${COVERAGE_CTES}
    SELECT DISTINCT c.ckan_id, c.ckan_name, c.title, c.n_resources
    FROM ckan c
    WHERE c.erddap_url IS NULL
      AND c.obis_dataset_id IS NULL
      AND (CAST(? AS text) IS NULL
           OR concat_ws(' ', c.ckan_name, c.title, c.ckan_id)
              ILIKE '%' || ? || '%')
    ORDER BY c.title
    LIMIT ?
  `,

  // OBIS datasets CDE serves that CKAN has no record of. Informational, not a
  // defect: CDE deliberately serves OBIS data the catalogue does not describe.
  "obis-without-ckan": `
    ${COVERAGE_CTES}
    SELECT o.dataset_id, o.title, adv.status, adv.attempted_at
    FROM app o
    LEFT JOIN advertised adv
           ON adv.dataset_id = o.dataset_id AND adv.source = 'obis'
    WHERE o.source_type = 'obis'
      AND NOT EXISTS (SELECT 1 FROM ckan c WHERE c.obis_dataset_id = o.dataset_id)
      AND (CAST(? AS text) IS NULL
           OR concat_ws(' ', o.dataset_id, o.title) ILIKE '%' || ? || '%')
    ORDER BY o.title
    LIMIT ?
  `,

  // CKAN describes an OBIS dataset CDE does not serve — either outside the
  // configured discovery selection, or dropped during harvest.
  "obis-not-in-app": `
    ${COVERAGE_CTES}
    SELECT DISTINCT c.ckan_id, c.ckan_name, c.title, c.obis_dataset_id
    FROM ckan c
    WHERE c.obis_dataset_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM app a
                       WHERE a.source_type = 'obis'
                         AND a.dataset_id = c.obis_dataset_id)
      AND (CAST(? AS text) IS NULL
           OR concat_ws(' ', c.obis_dataset_id, c.title, c.ckan_name)
              ILIKE '%' || ? || '%')
    ORDER BY c.title
    LIMIT ?
  `,
};

// Ceiling for the CSV export. The in-page table stays at COVERAGE_MAX_ROWS —
// a browser does not want 3000 rows of DOM — but "the full list" has to be
// obtainable, and a data manager acts on these in a spreadsheet anyway.
const COVERAGE_EXPORT_MAX_ROWS = 20000;

// RFC 4180: quote every field, double any embedded quote. Postgres arrays and
// titles carry commas and quotes routinely.
function toCsv(rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const cell = (v) =>
    v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`;
  return [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => cell(r[c])).join(",")),
  ].join("\n");
}

async function coverageBucket(bucket, q = null, limit = COVERAGE_MAX_ROWS) {
  const sql = COVERAGE_BUCKETS[bucket];
  if (!sql) return null;
  const result = await db.raw(sql, [q, q, limit + 1]);
  const truncated = result.rows.length > limit;
  return { rows: result.rows.slice(0, limit), truncated };
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

// Coverage: how the metadata catalogue and the data sources line up. Cached
// longer than the run-centric routes — the answer only moves when a harvest
// lands, and both queries sweep the whole attempt/catalogue sets.
router.get(
  "/coverage",
  ...pipeline({ filters: false, cacheFor: "5 minutes" }),
  async (req, res) => {
    const [summary, sources] = await Promise.all([
      coverageSummary(),
      coverageSources(),
    ]);
    // ckanUrl travels with the payload so the page can link to a record
    // without a second config channel into the browser bundle — the catalogue
    // is a deploy-time setting, and this response already describes it.
    res.json({
      summary,
      sources,
      ckanUrl: CKAN_URL,
      bucketLimit: COVERAGE_MAX_ROWS,
    });
  },
);

router.get(
  "/coverage/:bucket",
  ...pipeline({ filters: false, cacheFor: "5 minutes" }),
  async (req, res) => {
    const wantsCsv = req.query.format === "csv";
    const result = await coverageBucket(
      req.params.bucket,
      req.query.q || null,
      wantsCsv ? COVERAGE_EXPORT_MAX_ROWS : COVERAGE_MAX_ROWS,
    );
    if (result && wantsCsv) {
      res
        .type("text/csv")
        .set(
          "Content-Disposition",
          `attachment; filename="cde-${req.params.bucket}.csv"`,
        );
      return res.send(toCsv(result.rows));
    }
    // Unknown bucket names are a 404 rather than an empty list: an empty list
    // would read as "no gaps here", which is the opposite of "no such report".
    if (!result)
      return res.status(404).json({ error: "Unknown coverage bucket" });
    res.json({
      rows: result.rows,
      truncated: result.truncated,
      limit: COVERAGE_MAX_ROWS,
    });
  },
);

module.exports = router;
