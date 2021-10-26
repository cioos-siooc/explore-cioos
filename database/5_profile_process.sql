
-- This takes the data in temporary tables- ckan_data_loader,datasets_data_loader, and profiles_data_loader
-- and inserts records into tables datasets,profiles,points

CREATE OR REPLACE FUNCTION profile_process() RETURNS VOID AS $$
BEGIN

-- upsert profiles
INSERT INTO
        cioos_api.profiles (
                erddap_url,
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
        )
SELECT
        erddap_url,
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
FROM
        cioos_api.profiles_data_loader ON CONFLICT (erddap_url, dataset_id, profile_id) DO
UPDATE
SET
        time_min = excluded.time_min,
        time_max = excluded.time_max,
        latitude_min = excluded.latitude_min,
        latitude_max = excluded.latitude_max,
        longitude_min = excluded.longitude_min,
        longitude_max = excluded.longitude_max,
        depth_min = excluded.depth_min,
        depth_max = excluded.depth_max;

INSERT INTO
        cioos_api.datasets (erddap_url, dataset_id, cdm_data_type)
SELECT
        erddap_url,
        dataset_id,
        cdm_data_type
FROM
        cioos_api.datasets_data_loader ON CONFLICT (erddap_url, dataset_id) DO
UPDATE
SET
        cdm_data_type = EXCLUDED.cdm_data_type;

-- AFTER LOADING PROFILE DATA:
update
        cioos_api.profiles
set
        geom = st_transform(
                ST_SetSRID(ST_MakePoint(longitude_min, latitude_min), 4326),
                3857
        )
WHERE
        geom is null;

-- links profiles to datasets via PK
UPDATE
        cioos_api.profiles p
SET
        dataset_pk = d.pk
FROM
        cioos_api.datasets d
WHERE
        p.dataset_id = d.dataset_id
        AND p.erddap_url = d.erddap_url;

-- point PKs
DELETE FROM
        cioos_api.points;

-- with pp as (select distinct geom,hex_zoom_0,hex_zoom_1 from cioos_api.profiles)
with pp as (
        select
                distinct geom
        from
                cioos_api.profiles
)
insert into
        cioos_api.points (geom)
select
        geom
from
        pp;

UPDATE
        cioos_api.profiles
SET
        point_pk = points.pk
FROM
        cioos_api.points
WHERE
        points.geom = profiles.geom;

  END;
$$ LANGUAGE plpgsql;



