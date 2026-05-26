/* 
    Create the tables
 
 */


-- We are using features from PostGIS 3
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE schema cde;

SET search_path TO cde, public;

DROP TABLE IF EXISTS hexes_zoom_0;
CREATE TABLE hexes_zoom_0 (
    pk serial PRIMARY KEY,
    geom geometry(Polygon,3857)
);

CREATE INDEX ON cde.hexes_zoom_0 USING GIST (geom);

DROP TABLE IF EXISTS hexes_zoom_1;
CREATE TABLE hexes_zoom_1 (
    pk serial PRIMARY KEY,
    geom geometry(Polygon,3857)
  );

CREATE INDEX ON cde.hexes_zoom_1 USING GIST (geom);

 

-- ERDDAP Datasets
DROP TABLE IF EXISTS datasets;
CREATE TABLE datasets (
    pk serial PRIMARY KEY,
    pk_url INTEGER,
    dataset_id TEXT,
    erddap_url TEXT,
    platform TEXT,
    title TEXT,
    title_fr TEXT,
    summary TEXT,
    summary_fr TEXT,
    cdm_data_type text,
    organizations text[],
    eovs text[],
    ckan_id text,
    timeseries_id_variable text,
    profile_id_variable text,
    trajectory_id_variable text,
    organization_pks INTEGER[],
    n_profiles integer,
    profile_variables text[],
    num_columns integer,
    first_eov_column TEXT,
    source_type TEXT DEFAULT 'erddap',
    obis_nodes text[] DEFAULT '{}',
    UNIQUE(dataset_id, erddap_url)
);

-- List of organizations to show in CDE, from CKAN, can be many per dataset
DROP TABLE IF EXISTS organizations;
CREATE TABLE organizations (
    pk SERIAL PRIMARY KEY,
    pk_url INTEGER,
    name TEXT UNIQUE,
    color TEXT
);



-- One record per unique lat/long
-- this table is mostly used to build hexes, its not queried by the API
DROP TABLE IF EXISTS points;
CREATE TABLE points (
    pk serial PRIMARY KEY,
    geom geometry(Point,3857),
    -- these values are copied back into profiles
    hex_zoom_0 geometry(Polygon,3857),
    hex_zoom_1 geometry(Polygon,3857),
    hex_0_pk integer,
    hex_1_pk integer
);

CREATE INDEX ON points USING GIST (geom);
CREATE INDEX hex_zoom_0 ON cde.points USING GIST (hex_zoom_0);
CREATE INDEX hex_zoom_1 ON cde.points USING GIST (hex_zoom_1);


-- profiles/timeseries per dataset
-- hex polygon geometries are stored on cde.hexes_zoom_0/1; only the FK is
-- carried here. Tile / legend queries JOIN to those tables when polygon geom
-- is needed.
DROP TABLE IF EXISTS profiles;
CREATE TABLE profiles (
    pk serial PRIMARY KEY,
    geom geometry(Point,3857),
    dataset_pk integer REFERENCES datasets(pk),
    erddap_url text,
    dataset_id text,
    timeseries_id text,
    profile_id text,
    time_min timestamptz,
    time_max timestamptz,
    latitude double precision,
    longitude double precision,
    depth_min double precision,
    depth_max double precision,
    n_records bigint,
    records_per_day float,
    n_profiles bigint,
    hex_0_pk integer,
    hex_1_pk integer,
    point_pk INTEGER,
    days bigint,
    UNIQUE(erddap_url,dataset_id,timeseries_id,profile_id)
);

CREATE INDEX ON profiles USING GIST (geom);
CREATE INDEX ON profiles(latitude);
CREATE INDEX ON profiles(longitude);
-- Index for efficient filtering by dataset during incremental updates
CREATE INDEX ON profiles(erddap_url, dataset_id);
-- Index for faster lookups when joining with specific profile/timeseries IDs
CREATE INDEX ON profiles(erddap_url, dataset_id, timeseries_id, profile_id);




DROP TABLE IF EXISTS obis_cells;
CREATE TABLE obis_cells (
    pk serial PRIMARY KEY,
    -- geom is computed at INSERT time from latitude/longitude. Avoids the
    -- post-load full-table UPDATE that previously rewrote every row + every
    -- index entry. See obis_set_geom() in 5_profile_process.sql (now a no-op).
    dataset_pk integer,
    dataset_id text,
    latitude double precision,
    longitude double precision,
    geom geometry(Point, 3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)) STORED,
    scientific_names text[] DEFAULT '{}',
    -- WoRMS AphiaIDs corresponding to scientific_names. Populated post-harvest
    -- by joining each name to cde.scientific_name_vernaculars; see
    -- 5_profile_process.sql. Drives the rank-aware filter rolldown in
    -- web-api/utils/dbFilter.js — selecting a higher-rank name expands to a
    -- small integer set of descendant AphiaIDs and we test overlap on this
    -- column instead of building a 100k+ name array per tile request.
    aphia_ids integer[] NOT NULL DEFAULT '{}',
    n_records bigint,
    time_min timestamptz,
    time_max timestamptz,
    depth_min double precision,
    depth_max double precision,
    -- hex polygon geometries live on cde.hexes_zoom_0/1; only the FK is
    -- carried here. Tile / legend queries JOIN to get the polygon.
    hex_0_pk integer,
    hex_1_pk integer,
    point_pk integer,
    UNIQUE(dataset_id, latitude, longitude),
    FOREIGN KEY (dataset_pk) REFERENCES datasets(pk)
);

CREATE INDEX ON obis_cells USING GIST (geom);
CREATE INDEX ON obis_cells (dataset_id);
CREATE INDEX ON obis_cells (latitude, longitude);
-- Partial GIN: only cells whose aphia_ids are still empty (i.e. WoRMS hasn't
-- resolved any of their scientific_names yet). The literal-name predicate in
-- web-api/utils/dbFilter.js fires only for those rows; once aphia_ids is
-- populated, the integer-set GIN below covers the filter and the text GIN
-- isn't needed. Saves substantial disk on resolved cells.
CREATE INDEX obis_cells_scientific_names_gin ON cde.obis_cells USING GIN (scientific_names)
  WHERE coalesce(array_length(aphia_ids, 1), 0) = 0;
CREATE INDEX obis_cells_aphia_ids_gin         ON cde.obis_cells USING GIN (aphia_ids);

-- FILLFACTOR leaves room on each page for HOT updates on non-indexed columns
-- (dataset_pk, point_pk, hex_*_pk are filled by post-load UPDATEs). Reduces
-- bloat from those passes; modest effect now that the geom UPDATE is gone.
ALTER TABLE cde.obis_cells SET (fillfactor = 80);
ALTER TABLE cde.points SET (fillfactor = 80);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP MATERIALIZED VIEW IF EXISTS cde.obis_scientific_names;
CREATE MATERIALIZED VIEW cde.obis_scientific_names AS
  SELECT DISTINCT unnest(scientific_names) AS scientific_name
    FROM cde.obis_cells
   WHERE scientific_names IS NOT NULL;

CREATE UNIQUE INDEX ON cde.obis_scientific_names (scientific_name);
CREATE INDEX obis_scientific_names_trgm
  ON cde.obis_scientific_names USING GIN (scientific_name gin_trgm_ops);

-- Per-name OBIS record totals, used by populate_vernaculars.py to order names
-- by popularity (so --top N targets the most-impactful subset). The unnest +
-- GROUP BY over the full obis_cells table is a multi-minute scan, so we cache
-- it as a materialized view rather than recomputing on every script run.
-- Refreshed alongside obis_scientific_names in 5_profile_process.sql.
DROP MATERIALIZED VIEW IF EXISTS cde.obis_scientific_name_popularity;
CREATE MATERIALIZED VIEW cde.obis_scientific_name_popularity AS
  SELECT sn AS scientific_name,
         SUM(c.n_records)::bigint AS total_records
    FROM cde.obis_cells c,
         unnest(c.scientific_names) AS t(sn)
   WHERE c.scientific_names IS NOT NULL
   GROUP BY sn;

CREATE UNIQUE INDEX ON cde.obis_scientific_name_popularity (scientific_name);
CREATE INDEX obis_scientific_name_popularity_total_records
  ON cde.obis_scientific_name_popularity (total_records DESC);


-- Vernacular (common) names per scientific name, sourced from WoRMS.
-- Populated by db-loader/cde_db_loader/populate_vernaculars.py; not written by the harvester.
-- Searches use unnest + ILIKE; with a small row count (one per scientific name)
-- a seq scan is fast enough without a trigram index. Add a denormalised text
-- column + IMMUTABLE wrapper if this ever needs an index.
DROP TABLE IF EXISTS cde.scientific_name_vernaculars;
CREATE TABLE cde.scientific_name_vernaculars (
    scientific_name     text PRIMARY KEY,
    aphia_id            integer,
    rank                text,
    ancestor_aphia_ids  integer[] NOT NULL DEFAULT '{}',
    vernaculars_en      text[]    NOT NULL DEFAULT '{}',
    vernaculars_fr      text[]    NOT NULL DEFAULT '{}',
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    fetch_status        text NOT NULL DEFAULT 'ok'
);

-- GIN index supports the rank-aware filter expansion in web-api/utils/dbFilter.js:
-- given a selected name's aphia_id X, find every taxon whose ancestor chain
-- contains X via :X = ANY(ancestor_aphia_ids).
CREATE INDEX scientific_name_vernaculars_ancestors_gin
  ON cde.scientific_name_vernaculars USING GIN (ancestor_aphia_ids);


--
DROP TABLE IF EXISTS download_jobs;
CREATE TABLE download_jobs (
    pk SERIAL PRIMARY KEY,
    time timestamp with time zone DEFAULT now(),
    job_id text,
    email text,
    status text DEFAULT 'open'::text,
    time_total interval generated always as (time_complete - "time") stored,
    download_size numeric,
    estimate_size numeric,
    estimate_details text,
    erddap_report text,
    time_start timestamp with time zone,
    time_complete timestamp with time zone,
    downloader_input text,
    downloader_output text
);

DROP TABLE IF EXISTS skipped_datasets;
CREATE TABLE skipped_datasets (
    erddap_url text,
    dataset_id text,
    reason_code text
);

DROP TABLE IF EXISTS cde.organizations_lookup;
CREATE TABLE cde.organizations_lookup (
    pk SERIAL PRIMARY KEY,
    name TEXT UNIQUE
);

DROP TABLE IF EXISTS cde.datasets_lookup;
CREATE TABLE cde.datasets_lookup (
    pk serial PRIMARY KEY,
    dataset_id TEXT,
    erddap_url TEXT,
    UNIQUE(dataset_id, erddap_url)
);

-- Harvest audit log: one row per harvester invocation, one row per
-- (dataset, run) attempt. Consumed by the harvest-dashboard service so an
-- ERDDAP admin can self-serve "why didn't my dataset get harvested?".
-- skipped_datasets above is kept as the "current state" view used elsewhere.
DROP TABLE IF EXISTS cde.harvest_attempts;
DROP TABLE IF EXISTS cde.harvest_runs;

CREATE TABLE cde.harvest_runs (
    run_id        uuid PRIMARY KEY,
    started_at    timestamptz NOT NULL,
    finished_at   timestamptz,
    git_sha       text,
    status        text NOT NULL,           -- 'running' | 'ok' | 'failed'
    error_message text
);
CREATE INDEX harvest_runs_started_at_idx
    ON cde.harvest_runs (started_at DESC);

CREATE TABLE cde.harvest_attempts (
    run_id        uuid NOT NULL REFERENCES cde.harvest_runs(run_id) ON DELETE CASCADE,
    erddap_url    text NOT NULL,
    dataset_id    text NOT NULL,
    source        text NOT NULL,           -- 'erddap' | 'obis'
    status        text NOT NULL,           -- 'success' | 'skipped' | 'error'
    reason_code   text,                    -- one of harvest_errors.* when not success
    error_message text,
    duration_ms   integer,
    attempted_at  timestamptz NOT NULL,
    -- Newline-joined list of every URL the harvester fired for this
    -- dataset (info/<id>/index.csv, tabledap/<id>.csv?…). The dashboard
    -- splits on \n and renders each as a clickable link so an admin can
    -- replay the exact requests to debug a failure.
    query_urls    text,
    PRIMARY KEY (run_id, erddap_url, dataset_id)
);
CREATE INDEX harvest_attempts_dataset_idx
    ON cde.harvest_attempts (erddap_url, dataset_id, attempted_at DESC);
CREATE INDEX harvest_attempts_status_idx
    ON cde.harvest_attempts (status);
CREATE INDEX harvest_attempts_attempted_at_idx
    ON cde.harvest_attempts (attempted_at DESC);