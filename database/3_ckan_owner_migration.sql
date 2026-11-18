-- Add cde.datasets.ckan_owner to databases created before it existed.
--
-- 1_schema.sql only runs on a fresh volume; db_migrate applies [3-9]_*.sql on
-- every deploy. Numbered 3 so it sorts ahead of 9_incremental_upsert.sql,
-- whose upsert_datasets_from_temp() names it.
--
-- NULL until each dataset is re-harvested, and a skip_unchanged harvest never
-- reloads an unchanged dataset: run one forced harvest after deploying.
ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS ckan_owner text;
