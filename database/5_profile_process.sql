/* 

profile_process() 

 - set profiles columns: geom, dataset_pk, point_pk
 - set erddap_variables columns: dataset_pk 
 - recreate the points table
 
 */


CREATE OR REPLACE FUNCTION profile_process() RETURNS VOID AS $$
BEGIN


-- AFTER LOADING PROFILE DATA:

UPDATE
        cde.profiles
SET
        geom = st_transform(
                ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
                3857
        )
WHERE
        geom is null;

-- links profiles to datasets via PK
UPDATE
        cde.profiles p
SET
        dataset_pk = d.pk
FROM
        cde.datasets d
WHERE
        p.dataset_id = d.dataset_id
        AND p.erddap_url = d.erddap_url;

UPDATE
        cde.erddap_variables v
SET
        dataset_pk = d.pk
FROM
        cde.datasets d
WHERE
        v.dataset_id = d.dataset_id
        AND v.erddap_url = d.erddap_url;

-- point PKs
DELETE FROM
        cde.points;

WITH pp as (
        select
                distinct geom
        from
                cde.profiles
)
INSERT INTO
        cde.points (geom)
SELECT
        geom
FROM
        pp;

UPDATE
        cde.profiles
SET
        point_pk = points.pk
FROM
        cde.points
WHERE
        points.geom = profiles.geom;

  END;
$$ LANGUAGE plpgsql;



