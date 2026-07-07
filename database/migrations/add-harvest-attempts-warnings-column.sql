-- Add warnings to cde.harvest_attempts.
--
-- A non-fatal note for an otherwise-successful dataset, surfaced per dataset on
-- the harvest dashboard. First use: features hidden from the map because they
-- span a region larger than the point threshold (~1km) — the dataset still
-- harvests successfully and stays searchable via the geospatial filters.
--
-- Apply to a LIVE database (where re-running 1_schema.sql would DROP the table).
-- Idempotent — safe to run repeatedly.
--
--   docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
--     < database/migrations/add-harvest-attempts-warnings-column.sql

ALTER TABLE cde.harvest_attempts ADD COLUMN IF NOT EXISTS warnings text;
