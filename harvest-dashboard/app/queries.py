"""Read-only SQL queries against the harvester audit tables.

All queries are parameter-bound (no string interpolation of user input)
and return plain lists of dicts so the templates and JSON endpoints
share the same data shape.
"""

from sqlalchemy import text

from .db import engine

# Recent harvest runs across the whole stack (any source).
RECENT_RUNS_LIMIT = 20

# How many attempts to show in a per-dataset sparkline.
SPARKLINE_DEPTH = 10


def _rows(sql: str, **params):
    import uuid as _uuid

    def _norm(v):
        if isinstance(v, _uuid.UUID):
            return str(v)
        return v

    with engine.connect() as conn:
        result = conn.execute(text(sql), params)
        return [{k: _norm(v) for k, v in r._mapping.items()} for r in result]


def list_servers():
    """One row per (erddap_url, source) ever seen in harvest_attempts, with
    the latest run's success/skipped/error counts."""
    sql = """
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
    """
    return _rows(sql)


def recent_runs(limit: int = RECENT_RUNS_LIMIT):
    sql = """
    SELECT r.run_id,
           r.started_at,
           r.finished_at,
           r.git_sha,
           r.status,
           r.error_message,
           COUNT(a.*) FILTER (WHERE a.status = 'success') AS n_success,
           COUNT(a.*) FILTER (WHERE a.status = 'skipped') AS n_skipped,
           COUNT(a.*) FILTER (WHERE a.status = 'error')   AS n_error,
           COUNT(a.*) AS n_total
    FROM cde.harvest_runs r
    LEFT JOIN cde.harvest_attempts a USING (run_id)
    GROUP BY r.run_id, r.started_at, r.finished_at, r.git_sha,
             r.status, r.error_message
    ORDER BY r.started_at DESC
    LIMIT :limit
    """
    return _rows(sql, limit=limit)


def server_datasets(erddap_url: str, status_filter: str | None = None,
                    q: str | None = None):
    """All datasets ever seen on a given ERDDAP server with their *latest*
    attempt across all runs, plus a recent-attempt history strip."""
    sql = """
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
        WHERE erddap_url = :url
        ORDER BY erddap_url, dataset_id, attempted_at DESC
    ),
    last_success AS (
        SELECT erddap_url, dataset_id, MAX(attempted_at) AS last_success_at
        FROM cde.harvest_attempts
        WHERE erddap_url = :url AND status = 'success'
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
            WHERE erddap_url = :url
        ) ranked
        WHERE rn <= :depth
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
           sp.history_times
    FROM latest_attempt la
    LEFT JOIN last_success ls USING (erddap_url, dataset_id)
    LEFT JOIN sparkline   sp USING (erddap_url, dataset_id)
    WHERE (CAST(:status_filter AS text) IS NULL OR la.status = :status_filter)
      AND (
            CAST(:q AS text) IS NULL
            OR la.dataset_id     ILIKE '%' || :q || '%'
            OR la.reason_code    ILIKE '%' || :q || '%'
            OR la.error_message  ILIKE '%' || :q || '%'
          )
    ORDER BY
      CASE la.status WHEN 'error' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
      la.dataset_id
    """
    return _rows(sql, url=erddap_url, depth=SPARKLINE_DEPTH,
                 status_filter=status_filter, q=q)


def dataset_history(erddap_url: str, dataset_id: str):
    sql = """
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
    WHERE a.erddap_url = :url
      AND a.dataset_id = :dataset_id
    ORDER BY a.attempted_at DESC
    """
    return _rows(sql, url=erddap_url, dataset_id=dataset_id)


def run_detail(run_id: str):
    sql = """
    SELECT r.run_id,
           r.started_at::timestamptz  AS started_at,
           r.finished_at::timestamptz AS finished_at,
           r.git_sha,
           r.status,
           r.error_message,
           EXTRACT(EPOCH FROM (r.finished_at::timestamptz - r.started_at::timestamptz))::int AS duration_s
    FROM cde.harvest_runs r
    WHERE r.run_id = :run_id
    """
    rows = _rows(sql, run_id=run_id)
    return rows[0] if rows else None


def run_attempts(run_id: str):
    sql = """
    SELECT erddap_url, dataset_id, source, status, reason_code,
           error_message, duration_ms, attempted_at, query_urls
    FROM cde.harvest_attempts
    WHERE run_id = :run_id
    ORDER BY
      erddap_url,
      CASE status WHEN 'error' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
      dataset_id
    """
    return _rows(sql, run_id=run_id)


def reason_code_breakdown(erddap_url: str | None = None):
    """How many datasets fall in each reason_code, latest-attempt view.

    Used on overview + server pages to show which failure modes are
    dominant.
    """
    sql = """
    WITH latest_attempt AS (
        SELECT DISTINCT ON (erddap_url, dataset_id)
               erddap_url, dataset_id, status, reason_code
        FROM cde.harvest_attempts
        WHERE (CAST(:url AS text) IS NULL OR erddap_url = :url)
        ORDER BY erddap_url, dataset_id, attempted_at DESC
    )
    SELECT reason_code,
           COUNT(*) AS n
    FROM latest_attempt
    WHERE status <> 'success'
      AND reason_code IS NOT NULL
    GROUP BY reason_code
    ORDER BY n DESC
    """
    return _rows(sql, url=erddap_url)
