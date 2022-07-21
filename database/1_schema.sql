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
  DROP TABLE IF EXISTS hexes_zoom_1;

CREATE TABLE hexes_zoom_1 (
    pk serial PRIMARY KEY,
    geom geometry(Polygon,3857)
  );


-- The scraper will skip datasets in this table
DROP TABLE IF EXISTS skipped_datasets;
CREATE TABLE skipped_datasets (
    pk serial PRIMARY KEY,
    dataset_id text,
    erddap_url text
);

-- ERDDAP Datasets
DROP TABLE IF EXISTS datasets;
CREATE TABLE datasets (
    pk serial PRIMARY KEY,
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
    organization_pks INTEGER[],
    n_profiles integer,
    profile_variables text[],
    UNIQUE(dataset_id, erddap_url)
);

-- List of organizations to show in CDE, from CKAN, can be many per dataset
DROP TABLE IF EXISTS organizations;
CREATE TABLE organizations (
    pk SERIAL PRIMARY KEY,
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
    hex_0_pk integer REFERENCES hexes_zoom_0(pk),
    hex_1_pk integer REFERENCES hexes_zoom_1(pk)
);

CREATE INDEX
  ON points
  USING GIST (geom);

 


-- profiles/timeseries per dataset
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
    -- hex polygon that this point is in for zoom 0 (zoomed out)
    hex_zoom_0 geometry(polygon,3857),
    hex_zoom_1 geometry(polygon,3857),
    hex_0_pk integer references hexes_zoom_0(pk),
    hex_1_pk integer references hexes_zoom_1(pk),
    point_pk INTEGER,
    days bigint,
    UNIQUE(erddap_url,dataset_id,timeseries_id,profile_id)
);

CREATE INDEX ON profiles USING GIST (geom);
CREATE INDEX ON profiles USING GIST (hex_zoom_0);
CREATE INDEX ON profiles USING GIST (hex_zoom_1);
CREATE INDEX ON profiles(latitude);
CREATE INDEX ON profiles(longitude);




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


DROP TABLE IF EXISTS erddap_variables;
CREATE TABLE erddap_variables (
    dataset_pk integer REFERENCES datasets(pk),
    erddap_url text,
    dataset_id text,
    "name" text,
    "type" text,
    actual_range text,
    cf_role text,
    standard_name text
);

DROP TABLE IF EXISTS skipped_datasets;
CREATE TABLE skipped_datasets (
    erddap_url text,
    dataset_id text,
    reason_code text
);


DROP TABLE IF EXISTS eov_to_standard_name;
CREATE TABLE eov_to_standard_name (
    pk SERIAL PRIMARY KEY,
    eov text,
    standard_name text,
    UNIQUE(eov,standard_name)
);

-- DROP VIEW dataset_to_eov;
CREATE OR REPLACE VIEW dataset_to_eov AS
 SELECT d.pk, eov,v.standard_name
   FROM datasets d
     JOIN erddap_variables v ON v.dataset_pk =  d.pk
     JOIN eov_to_standard_name ets ON ets.standard_name = v.standard_name;

