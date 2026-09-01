-- Add cde.harvest_runs + cde.harvest_attempts: the per-run harvest audit trail
-- behind the harvest dashboard. Mirrors the CREATE TABLEs in 1_schema.sql; see
-- that file for column comments.
--
-- Needed because these tables exist ONLY in 1_schema.sql, which Postgres runs
-- just once on a fresh volume (docker-entrypoint-initdb.d). A database created
-- before they were added never gets them, and db_migrate never applies
-- 1_schema.sql (it DROPs tables). Without this, the sibling ALTER migrations
-- (add-harvest-attempts-warnings-column.sql, add-harvest-run-prefect-columns.sql)
-- fail with 'relation "cde.harvest_attempts" does not exist', which aborts
-- db_migrate and — via service_completed_successfully — blocks web-api and nginx
-- from ever starting.
--
-- ORDERING: db_migrate applies migrations/*.sql in glob (alphabetical) order, so
-- this filename must keep sorting before both add-harvest-attempts-* and
-- add-harvest-run-* files. harvest_attempts also has an FK to harvest_runs, so
-- harvest_runs is created first within this file.
--
-- The columns below are the CURRENT shape (including the ones those two ALTER
-- migrations add), so on a fresh-but-missing table they land complete and the
-- later ALTERs no-op via IF NOT EXISTS.
--
-- Apply to a LIVE database. Idempotent — safe to run repeatedly.

CREATE TABLE IF NOT EXISTS cde.harvest_runs (
    run_id        uuid PRIMARY KEY,
    started_at    timestamptz NOT NULL,
    finished_at   timestamptz,
    git_sha       text,
    status        text NOT NULL,           -- 'running' | 'ok' | 'failed'
    error_message text,
    prefect_flow_run_id text,              -- Prefect flow run id; null for CLI runs
    scope         text,                    -- 'full' (all sources) | 'single' (one source)
    triggered_source text,                 -- requested source (erddap url or 'obis') for single-source runs
    triggered_by  text                     -- dashboard user who launched it, if any
);
CREATE INDEX IF NOT EXISTS harvest_runs_started_at_idx
    ON cde.harvest_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS cde.harvest_attempts (
    run_id        uuid NOT NULL REFERENCES cde.harvest_runs(run_id) ON DELETE CASCADE,
    erddap_url    text NOT NULL,
    dataset_id    text NOT NULL,
    source        text NOT NULL,           -- 'erddap' | 'obis'
    status        text NOT NULL,           -- 'success' | 'skipped' | 'error'
    reason_code   text,                    -- one of harvest_errors.* when not success
    error_message text,
    duration_ms   integer,
    attempted_at  timestamptz NOT NULL,
    query_urls    text,
    warnings      text,
    PRIMARY KEY (run_id, erddap_url, dataset_id)
);
CREATE INDEX IF NOT EXISTS harvest_attempts_dataset_idx
    ON cde.harvest_attempts (erddap_url, dataset_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS harvest_attempts_status_idx
    ON cde.harvest_attempts (status);
CREATE INDEX IF NOT EXISTS harvest_attempts_attempted_at_idx
    ON cde.harvest_attempts (attempted_at DESC);
