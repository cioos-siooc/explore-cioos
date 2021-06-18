CREATE EXTENSION IF NOT EXISTS postgis;
CREATE schema cioos_api;
CREATE TABLE cioos_api.servers (pk SERIAL PRIMARY KEY, url TEXT UNIQUE);
-- from CSV: ,erddap_url,dataset_id,cdm_data_type,dataset_standard_names

CREATE TABLE cioos_api.datasets (
    pk serial PRIMARY KEY,
    dataset_id text,
    erddap_url text REFERENCES cioos_api.servers(url),
    cdm_data_type text,
    dataset_standard_names text[],
    ckan_record jsonb,
    profile_variable text,
    ckan_url text,
    eovs text[],
    ckan_id text,
    parties text[],
    UNIQUE(dataset_id, erddap_url)
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

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom);

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom_snapped_0);

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom_snapped_1);

-- hex bins at 2 zoom levels
alter table cioos_api.profiles add column geom_snapped_0 geometry; 
alter table cioos_api.profiles add column geom_snapped_1 geometry; 

-- create zoom levels
-- zoom 0 : 10000
with zoom as (
select p.pk,hexes.geom from ST_HexagonGrid(
        10000,
        st_setsrid(ST_EstimatedExtent('cioos_api','profiles', 'geom'),3857)
    ) AS hexes
    
    inner JOIN cioos_api.profiles p
    ON ST_Intersects(p.geom, hexes.geom)
    )
UPDATE cioos_api.profiles p
SET geom_snapped_0 = z.geom
FROM zoom AS z
WHERE z.pk = p.pk;

-- zoom 1 : 5000
with zoom as (
select p.pk,hexes.geom from ST_HexagonGrid(
        5000,
        st_setsrid(ST_EstimatedExtent('cioos_api','profiles', 'geom'),3857)
    ) AS hexes
    
    inner JOIN cioos_api.profiles p
    ON ST_Intersects(p.geom, hexes.geom)
    )
UPDATE cioos_api.profiles p
SET geom_snapped_1 = z.geom
FROM zoom AS z
WHERE z.pk = p.pk;
