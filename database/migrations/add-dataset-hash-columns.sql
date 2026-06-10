-- Add content-hash + harvest-timestamp columns to cde.datasets.
--
-- Supports skipping re-harvest of unchanged file-backed datasets:
--   content_hash    - SHA-256 of the dataset's Croissant ld+json (set only when it
--                     lists files via a `distribution` of cr:FileObject); NULL otherwise.
--   last_updated_at - when the content (hash) last changed / the dataset was harvested.
--   verified_at     - last run we checked this dataset (bumped even when skipped).
--
-- Apply to a LIVE database (where re-running 1_schema.sql would DROP the table).
-- Idempotent — safe to run repeatedly.
--
--   docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
--     < database/migrations/add-dataset-hash-columns.sql

ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS last_updated_at timestamptz;
ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS verified_at timestamptz;
