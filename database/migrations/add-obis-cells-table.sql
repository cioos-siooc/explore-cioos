-- Add cde.obis_cells: OBIS occurrence coverage cells (one row per dataset x
-- binned lat/lon). Mirrors the CREATE TABLE in 1_schema.sql; see that file for
-- column comments.
--
-- Needed for the same reason as add-harvest-attempts-and-runs-tables.sql: this
-- table exists only in 1_schema.sql, which Postgres runs once on a fresh volume
-- (docker-entrypoint-initdb.d). A database created before the OBIS work landed
-- never gets it, and db_migrate never applies 1_schema.sql (it DROPs tables).
--
-- ORDERING: db_migrate applies migrations/*.sql in glob (alphabetical) order.
-- This filename must keep sorting before append-only-points.sql (whose dedup
-- branch UPDATEs cde.obis_cells) and autovacuum-churned-tables.sql (which tunes
-- it) — 'add-' < 'app' < 'aut' holds today.
--
-- The autovacuum storage params and fillfactor from 1_schema.sql are NOT set
-- here: autovacuum-churned-tables.sql applies the former on every deploy, and
-- fillfactor is set below to match 1_schema.sql exactly.
--
-- Apply to a LIVE database. Idempotent — safe to run repeatedly.

CREATE TABLE IF NOT EXISTS cde.obis_cells (
    pk serial PRIMARY KEY,
    dataset_pk integer,
    dataset_id text,
    latitude double precision,
    longitude double precision,
    geom geometry(Point, 3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)) STORED,
    scientific_names text[] DEFAULT '{}',
    aphia_ids integer[] NOT NULL DEFAULT '{}',
    n_records bigint,
    time_min timestamptz,
    time_max timestamptz,
    depth_min double precision,
    depth_max double precision,
    hex_0_pk integer,
    hex_1_pk integer,
    point_pk integer,
    UNIQUE(dataset_id, latitude, longitude),
    FOREIGN KEY (dataset_pk) REFERENCES cde.datasets(pk)
);

-- 1_schema.sql creates the first three of these unnamed (auto-named
-- obis_cells_geom_idx / _dataset_id_idx / _latitude_longitude_idx). Named
-- explicitly here so IF NOT EXISTS can actually match on re-run.
CREATE INDEX IF NOT EXISTS obis_cells_geom_idx
    ON cde.obis_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS obis_cells_dataset_id_idx
    ON cde.obis_cells (dataset_id);
CREATE INDEX IF NOT EXISTS obis_cells_latitude_longitude_idx
    ON cde.obis_cells (latitude, longitude);
-- Partial GIN: only cells whose aphia_ids are still empty; see 1_schema.sql.
CREATE INDEX IF NOT EXISTS obis_cells_scientific_names_gin
    ON cde.obis_cells USING GIN (scientific_names)
    WHERE coalesce(array_length(aphia_ids, 1), 0) = 0;
CREATE INDEX IF NOT EXISTS obis_cells_aphia_ids_gin
    ON cde.obis_cells USING GIN (aphia_ids);

ALTER TABLE cde.obis_cells SET (fillfactor = 80);
