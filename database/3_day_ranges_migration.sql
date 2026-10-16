-- Add the `day_ranges` day-set columns to databases created before they existed
-- (1_schema.sql only runs on a fresh volume; db_migrate applies [3-9]_*.sql on
-- every deploy). Idempotent; a no-op on fresh volumes.
--
-- Numbered 3 so it sorts ahead of 4_create_hexes.sql and 9_incremental_upsert.sql,
-- which name the column.
--
-- A NULL day_ranges means "day set unknown" and hexMetric.js falls back to the
-- row's [time_min, time_max] span, so deploy order does not matter.
ALTER TABLE cde.profiles          ADD COLUMN IF NOT EXISTS day_ranges daterange[];
ALTER TABLE cde.obis_cells        ADD COLUMN IF NOT EXISTS day_ranges daterange[];
ALTER TABLE cde.trajectory_hexes  ADD COLUMN IF NOT EXISTS day_ranges daterange[];
-- The per-dataset rollup of the three above; backfilled at the bottom of
-- 5_profile_process.sql, which defines the function that builds it.
ALTER TABLE cde.datasets          ADD COLUMN IF NOT EXISTS day_ranges daterange[];
