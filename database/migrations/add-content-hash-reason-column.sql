-- Add content_hash_reason to cde.datasets.
--
-- Explains *why* a dataset has no content_hash:
--   content_hash_reason - HASH_* code (database-backed / no file list, Croissant HTTP error,
--                         Croissant unreadable, federated source unresolved); NULL when a
--                         hash was produced. Lets the harvest dashboard distinguish
--                         "correctly unhashed" from "failed to hash".
--
-- Apply to a LIVE database (where re-running 1_schema.sql would DROP the table).
-- Idempotent — safe to run repeatedly.
--
--   docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
--     < database/migrations/add-content-hash-reason-column.sql

ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS content_hash_reason text;
