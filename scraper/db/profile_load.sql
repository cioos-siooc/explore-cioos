ROLLBACK;
BEGIN;
delete from cioos_api.profiles;
delete from cioos_api.datasets;
\copy cioos_api.datasets(erddap_url,dataset_id,cdm_data_type) FROM '/Users/nate.rosenstock/dev/ceda/scraper/datasets_26d90b.csv' WITH CSV HEADER;
\copy cioos_api.profiles(erddap_url,dataset_id,profile_id,time_min,time_max,latitude_min,latitude_max,longitude_min,longitude_max,depth_min,depth_max) FROM '/Users/nate.rosenstock/dev/ceda/scraper/profiles_26d90b.csv' WITH CSV HEADER;


-- This is for finding bad data!
-- SELECT * FROM cioos_api.profiles WHERE
--     latitude_min <= -90 OR 
--     latitude_max >= 90 OR 
--     longitude_min <= -180 OR 
--     longitude_min >= 180;

DELETE FROM cioos_api.profiles WHERE
    latitude_min <= -90 OR 
    latitude_max >= 90 OR 
    longitude_min <= -180 OR 
    longitude_min >= 180;

-- AFTER LOADING PROFILE DATA:
update cioos_api.profiles set geom=st_transform(ST_SetSRID(ST_MakePoint(longitude_min, latitude_min),4326),3857);

-- if datasets have no depth assume depth=0
UPDATE cioos_api.profiles SET depth_min=0,depth_max=0 WHERE depth_min is NULL;


-- links profiles to datasets via PK
UPDATE cioos_api.profiles p
SET dataset_pk = d.pk
FROM cioos_api.datasets d
WHERE p.dataset_id=d.dataset_id AND
p.erddap_url = d.erddap_url;

-- point PKs
DELETE FROM cioos_api.points;
-- with pp as (select distinct geom,geom_snapped_0,geom_snapped_1 from cioos_api.profiles)
with pp as (select distinct geom from cioos_api.profiles)
insert into cioos_api.points (geom) select geom from pp;

UPDATE cioos_api.profiles
SET point_pk=points.pk
FROM cioos_api.points
WHERE points.geom = profiles.geom;


----------------------------------------------------------
-- create hexagon zoom levels, this takes a long time
----------------------------------------------------------

with zoom as (
select p.pk,hexes.geom from ST_HexagonGrid(
        100000,
        st_setsrid(ST_EstimatedExtent('cioos_api','profiles', 'geom'),3857)
    ) AS hexes
    
    inner JOIN cioos_api.profiles p
    ON ST_Intersects(p.geom, hexes.geom)
    )
UPDATE cioos_api.profiles p
SET geom_snapped_0 = z.geom
FROM zoom AS z
WHERE z.pk = p.pk  AND geom_snapped_1 is null;

-- zoom 1 : 10000
with zoom as (
select p.pk,hexes.geom from ST_HexagonGrid(
        10000,
        st_setsrid(ST_EstimatedExtent('cioos_api','profiles', 'geom'),3857)
    ) AS hexes
    
    inner JOIN cioos_api.profiles p
    ON ST_Intersects(p.geom, hexes.geom)
    )
UPDATE cioos_api.profiles p
SET geom_snapped_1 = z.geom
FROM zoom AS z
WHERE z.pk = p.pk  AND geom_snapped_1 is null;     

-- Run after scraper runs
-- UPDATE cioos_api.datasets d
-- SET cdm_data_type=o.cdm_data_type
-- FROM cioos_api.cdm_data_type_override o
-- WHERE o.erddap_url=d.erddap_url AND
-- o.dataset_id=d.dataset_id;

 -- changed ODF_CTD_Profiles to  subSurfaceTemperature, {16}. Added 16,"Bedford Institute of Oceanography" to organizations



ROLLBACK;