-- We are using features from PostGIS 3
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE schema cioos_api;

-- The scraper will skip datasets in this table
DROP TABLE IF EXISTS cioos_api.skip_datasets;
CREATE TABLE cioos_api.skip_datasets (
    pk serial PRIMARY KEY,
    dataset_id text,
    erddap_url text
);

-- ERDDAP Datasets
DROP TABLE IF EXISTS cioos_api.datasets;
CREATE TABLE cioos_api.datasets (
    pk serial PRIMARY KEY,
    dataset_id text,
    erddap_url text,
    title TEXT,
    title_fr TEXT,
    summary TEXT,
    summary_fr TEXT,
    cdm_data_type text,
    organizations text[],
    ckan_record jsonb,
    profile_variable text,
    ckan_url text,
    eovs text[],
    ceda_eovs text[],
    ckan_id text,
    organization_pks INTEGER[],
    n_profiles integer,
    profile_variables text[],
    UNIQUE(dataset_id, erddap_url)
);

-- List of organizations to show in CEDA, from CKAN, can be many per dataset
DROP TABLE IF EXISTS cioos_api.organizations;
CREATE TABLE cioos_api.organizations (
    pk SERIAL PRIMARY KEY,
    name text UNIQUE,
    color text
);

-- profiles/timeseries per dataset
-- data comes via cioos_api.profiles_data_loader
DROP TABLE IF EXISTS cioos_api.profiles;
CREATE TABLE cioos_api.profiles (
    pk serial PRIMARY KEY,
    geom geometry(Point,3857),
    dataset_pk integer REFERENCES cioos_api.datasets(pk),
    erddap_url text,
    dataset_id text,
    timeseries_profile_id text,
    timeseries_id text,
    profile_id text,
    time_min timestamptz,
    time_max timestamptz,
    latitude_min double precision,
    latitude_max double precision,
    longitude_min double precision,
    longitude_max double precision,
    depth_min double precision,
    depth_max double precision,
    n_records integer,
    records_per_day float,
    n_profiles integer,
    -- hex polygon that this point is in for zoom 0 (zoomed out)
    hex_zoom_0 geometry(polygon,3857),
    hex_zoom_1 geometry(polygon,3857),
    point_pk INTEGER,
    UNIQUE(erddap_url,dataset_id,timeseries_id,profile_id)
);

CREATE INDEX ON cioos_api.profiles USING GIST (geom);
CREATE INDEX ON cioos_api.profiles USING GIST (hex_zoom_0);
CREATE INDEX ON cioos_api.profiles USING GIST (hex_zoom_1);
CREATE INDEX ON cioos_api.profiles(latitude_min);
CREATE INDEX ON cioos_api.profiles(latitude_max);
CREATE INDEX ON cioos_api.profiles(longitude_min);
CREATE INDEX ON cioos_api.profiles(longitude_max);


-- One record per unique lat/long
-- this table is mostly used to build hexes, its not queried by the API
DROP TABLE IF EXISTS cioos_api.points;
CREATE TABLE cioos_api.points (
    pk serial PRIMARY KEY,
    geom geometry(Point,3857),
    -- these values are copied back into cioos_api.profiles
    hex_zoom_0 geometry(Polygon,3857),
    hex_zoom_1 geometry(Polygon,3857)
);

CREATE INDEX
  ON cioos_api.points
  USING GIST (geom);

 

--
DROP TABLE IF EXISTS cioos_api.download_jobs;
CREATE TABLE cioos_api.download_jobs (
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


DROP TABLE IF EXISTS cioos_api.erddap_variables;
CREATE TABLE cioos_api.erddap_variables (
    dataset_pk integer REFERENCES cioos_api.datasets(pk),
    erddap_url text NOT NULL,
    dataset_id text NOT NULL,
    "name" text NOT NULL,
    "type" text NOT NULL,
    actual_range text,
    cf_role text,
    standard_name text
);


DROP TABLE IF EXISTS cioos_api.eov_to_standard_name;
CREATE TABLE cioos_api.eov_to_standard_name (
    pk SERIAL PRIMARY KEY,
    eov text,
    standard_name text,
    UNIQUE(eov,standard_name)
);

-- DROP VIEW cioos_api.dataset_to_eov;
CREATE OR REPLACE VIEW cioos_api.dataset_to_eov AS
 SELECT d.pk, eov,v.standard_name
   FROM cioos_api.datasets d
     JOIN cioos_api.erddap_variables v ON v.dataset_pk =  d.pk
     JOIN cioos_api.eov_to_standard_name ets ON ets.standard_name = v.standard_name;

DROP FUNCTION IF EXISTS range_intersection_length( numrange, numrange );
CREATE OR REPLACE FUNCTION range_intersection_length(a numrange,b numrange )
   RETURNS numeric 
   LANGUAGE plpgsql
  AS
$$
DECLARE 
BEGIN
RETURN upper(a*b)-lower(a*b);
END;
$$;

DROP FUNCTION IF EXISTS range_intersection_length( tstzrange, tstzrange );
CREATE OR REPLACE FUNCTION range_intersection_length(a tstzrange,b tstzrange )
   RETURNS interval 
   LANGUAGE plpgsql
  as
$$
DECLARE 
BEGIN
RETURN upper(a*b)-lower(a*b);
END;
$$;