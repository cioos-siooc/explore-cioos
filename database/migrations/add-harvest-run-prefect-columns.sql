-- Add Prefect-link + run-scope columns to cde.harvest_runs.
--
-- Apply to a LIVE database (where re-running 1_schema.sql would DROP and wipe
-- the harvest audit history). Idempotent — safe to run repeatedly.
--
--   docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
--     < database/migrations/add-harvest-run-prefect-columns.sql

ALTER TABLE cde.harvest_runs ADD COLUMN IF NOT EXISTS prefect_flow_run_id text;
ALTER TABLE cde.harvest_runs ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE cde.harvest_runs ADD COLUMN IF NOT EXISTS triggered_source text;
ALTER TABLE cde.harvest_runs ADD COLUMN IF NOT EXISTS triggered_by text;
