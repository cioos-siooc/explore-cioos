-- Add cde.ckan_records to databases created before it existed.
--
-- The canonical DDL is in 1_schema.sql, which only ever runs on a fresh volume.
-- This file is picked up by the db_migrate compose service, which applies
-- [3-9]_*.sql on every deploy, so live databases get the table without the
-- volume drop + full re-harvest that database/README.md otherwise requires for
-- a schema change. Creating a new table is safe and idempotent — nothing else
-- reads or writes it until a harvest populates it, and the coverage routes in
-- web-api/routes/harvest.js report an empty snapshot rather than failing.
--
-- No-op on fresh volumes: 1_schema.sql has already created it. Deliberately
-- CREATE TABLE IF NOT EXISTS rather than the DROP + CREATE in 1_schema.sql,
-- which would discard the snapshot on every deploy.
--
-- WHY the table exists: cde.harvest_attempts records what the harvester *did*,
-- one row per dataset an ERDDAP server advertises. It can therefore answer
-- "what did ERDDAP offer that we failed to ingest", but it has nothing to say
-- about the metadata catalogue — the CKAN listing was fetched on every run and
-- discarded, so a CKAN record whose dataset was never harvested left no trace
-- anywhere. This table is that missing half, and it is what lets the harvest
-- dashboard diff metadata (CKAN) against the data sources (ERDDAP, OBIS).
CREATE TABLE IF NOT EXISTS cde.ckan_records (
    pk              serial PRIMARY KEY,
    ckan_id         text NOT NULL,
    ckan_name       text,
    title           text,
    title_fr        text,
    organizations   text[],
    eovs            text[],
    erddap_url      text,
    dataset_id      text,
    obis_dataset_id text,
    n_resources     integer,
    snapshot_at     timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ckan_records_erddap_idx
    ON cde.ckan_records (rtrim(erddap_url, '/'), dataset_id);
CREATE INDEX IF NOT EXISTS ckan_records_obis_idx
    ON cde.ckan_records (obis_dataset_id);
CREATE INDEX IF NOT EXISTS ckan_records_ckan_id_idx
    ON cde.ckan_records (ckan_id);
