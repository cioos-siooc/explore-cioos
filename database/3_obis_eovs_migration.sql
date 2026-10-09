-- Add the OBIS EOV derivation columns and mapping table to databases created
-- before they existed. Canonical DDL is in 1_schema.sql; see
-- 3_obis_days_migration.sql for why this rides on db_migrate instead of a
-- volume reset. No-op on fresh volumes.
ALTER TABLE cde.datasets   ADD COLUMN IF NOT EXISTS declared_eovs text[];
ALTER TABLE cde.obis_cells ADD COLUMN IF NOT EXISTS eovs text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS obis_cells_eovs_gin ON cde.obis_cells USING GIN (eovs);
ALTER TABLE cde.scientific_name_vernaculars ADD COLUMN IF NOT EXISTS functional_groups text[];

CREATE TABLE IF NOT EXISTS cde.eov_taxa (
    eov               text PRIMARY KEY,
    aphia_ids         integer[] NOT NULL DEFAULT '{}',
    exclude_aphia_ids integer[] NOT NULL DEFAULT '{}',
    functional_groups text[]    NOT NULL DEFAULT '{}'
);

-- Until an OBIS dataset is re-harvested its `eovs` is still exactly what CKAN
-- declared, so seed declared_eovs from it. Without this the first
-- obis_derive_eovs() would rebuild those datasets' eovs without their CKAN
-- EOVs. Idempotent: once set, declared_eovs is never NULL for OBIS rows.
UPDATE cde.datasets
   SET declared_eovs = coalesce(eovs, '{}')
 WHERE source_type = 'obis' AND declared_eovs IS NULL;
