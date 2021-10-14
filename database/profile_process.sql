-- This takes the data in temporary tables- ckan_data_loader,datasets_data_loader, and profiles_data_loader
-- and inserts records into tables datasets,profiles,points
ROLLBACK;
BEGIN;

DELETE FROM cioos_api.profiles;
DELETE FROM cioos_api.datasets;

INSERT INTO cioos_api.profiles (erddap_url,
        dataset_id,
        profile_id,
        time_min,
        time_max,
        latitude_min,
        latitude_max,
        longitude_min,
        longitude_max,
        depth_min,
        depth_max)
SELECT erddap_url,
        dataset_id,
        profile_id,
        time_min,
        time_max,
        latitude_min,
        latitude_max,
        longitude_min,
        longitude_max,
        depth_min,
        depth_max
FROM cioos_api.profiles_data_loader;

INSERT INTO cioos_api.datasets (erddap_url,dataset_id, cdm_data_type )
SELECT  erddap_url,
        dataset_id,
        cdm_data_type
FROM cioos_api.datasets_data_loader;

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
-- with pp as (select distinct geom,hex_zoom_0,hex_zoom_1 from cioos_api.profiles)
with pp as (select distinct geom from cioos_api.profiles)
insert into cioos_api.points (geom) select geom from pp;

UPDATE cioos_api.profiles
SET point_pk=points.pk
FROM cioos_api.points
WHERE points.geom = profiles.geom;


COMMIT;