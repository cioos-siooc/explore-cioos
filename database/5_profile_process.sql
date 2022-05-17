
-- This takes the data in temporary tables- ckan_data_loader,datasets_data_loader, and profiles_data_loader
-- and inserts records into tables datasets,profiles,points

CREATE OR REPLACE FUNCTION profile_process() RETURNS VOID AS $$
BEGIN


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

UPDATE
        cioos_api.erddap_variables v
SET
        dataset_pk = d.pk
FROM
        cioos_api.datasets d
WHERE
        v.dataset_id = d.dataset_id
        AND v.erddap_url = d.erddap_url;

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

UPDATE cioos_api.profiles set days=date_part('days',time_max-time_min)+1;

