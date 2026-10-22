-- Add cde.datasets.platform_category to databases created before it existed.
--
-- The canonical DDL is in 1_schema.sql, which only ever runs on a fresh volume;
-- db_migrate applies [3-9]_*.sql on every deploy. Numbered 3 so it sorts ahead
-- of 9_incremental_upsert.sql, whose upsert_datasets_from_temp() names it.
--
-- NULL until each dataset is re-harvested (HARVEST_VERSION was bumped with it,
-- so the next run reloads every dataset).
ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS platform_category text;
