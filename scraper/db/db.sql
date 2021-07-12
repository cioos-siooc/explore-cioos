CREATE EXTENSION IF NOT EXISTS postgis;
CREATE schema cioos_api;
CREATE TABLE cioos_api.servers (pk SERIAL PRIMARY KEY, url TEXT UNIQUE);
-- from CSV: ,erddap_url,dataset_id,cdm_data_type

CREATE TABLE cioos_api.datasets (
    pk serial PRIMARY KEY,
    dataset_id text,
    erddap_url text REFERENCES cioos_api.servers(url),
    cdm_data_type text,
    ckan_record jsonb,
    profile_variable text,
    ckan_url text,
    eovs text[],
    ckan_id text,
    parties text[],
    organization_pks INTEGER[],
    point_pk INTEGER,
    geom_snapped_0 geometry(polygon,3857),
    geom_snapped_1 geometry(polygon,3857),
    UNIQUE(dataset_id, erddap_url)
);
CREATE TABLE cioos_api.organizations (
    pk SERIAL PRIMARY KEY,
    name text,
    color text
);
-- from csv: server,dataset_id,time_min,time_max,latitude_min,latitude_max,longitude_min,longitude_max
DROP TABLE IF EXISTS cioos_api.profiles;
CREATE TABLE cioos_api.profiles (
    pk serial PRIMARY KEY,
    geom geometry(Point,4326),
    dataset_pk integer REFERENCES cioos_api.datasets(pk),
    server_pk integer REFERENCES cioos_api.servers(pk),
    erddap_url text,
    dataset_id text,
    time_min timestamp with time zone,
    time_max timestamp with time zone,
    latitude_min double precision,
    latitude_max double precision,
    longitude_min double precision,
    longitude_max double precision,
    depth_min double precision,
    depth_max double precision,
    profile_id text
);
create index on cioos_api.profiles (point_pk);

-- DROP TABLE cioos_api.cdm_data_type_override;
-- CREATE TABLE cioos_api.cdm_data_type_override (
--     pk SERIAL PRIMARY KEY,
--     erddap_url text,
--     dataset_id text,
--     cdm_data_type text
-- );  

DROP TABLE cioos_api.allowed_users;
CREATE TABLE cioos_api.allowed_users (
    pk SERIAL PRIMARY KEY,
    email text UNIQUE
);

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom);

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom_snapped_0);

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom_snapped_1);

CREATE TABLE cioos_api.ckan_data_loader (
    erddap_url text,
    dataset_id text,
    eovs text[],
    ckan_id text,
    parties text[],
    ckan_record jsonb
);


