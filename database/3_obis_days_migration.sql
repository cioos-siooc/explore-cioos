-- Add cde.obis_cells.days to databases created before it existed (1_schema.sql
-- only runs on a fresh volume; db_migrate applies [3-9]_*.sql on every deploy).
-- Idempotent; a no-op on fresh volumes. Numbered 3 so it sorts ahead of
-- 9_incremental_upsert.sql, which names the column.
--
-- NULL until each OBIS dataset is re-harvested, and hexMetric.js coalesces it
-- to 0, so OBIS reads as 0 days until then.
ALTER TABLE cde.obis_cells ADD COLUMN IF NOT EXISTS days bigint;
