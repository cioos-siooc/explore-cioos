/* 

profile_process() 

 - set profiles columns: geom, dataset_pk, point_pk
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

UPDATE cde.profiles set days=date_part('days',time_max-time_min)+1;

-- Set number of profiles per dataset
WITH profiles_per_dataset
     AS (SELECT d.pk,
                COUNT(p.pk)
         FROM   cde.datasets d
                JOIN cde.profiles p
                  ON p.dataset_pk = d.pk
         GROUP  BY d.pk)
UPDATE cde.datasets d
SET    n_profiles = profiles_per_dataset.count
FROM   profiles_per_dataset
WHERE  profiles_per_dataset.pk = d.pk;  


-- insert any new names. changed/deleted datasets will always be in here
INSERT INTO cde.organizations_lookup (name) select name from cde.organizations ON CONFLICT DO NOTHING;
INSERT INTO cde.datasets_lookup (erddap_url,dataset_id) select erddap_url,dataset_id from cde.datasets ON CONFLICT DO NOTHING;

UPDATE cde.datasets
SET pk_url=datasets_lookup.pk
FROM cde.datasets_lookup
WHERE datasets_lookup.erddap_url=datasets.erddap_url AND
datasets_lookup.dataset_id = datasets.dataset_id;



  END;
$$ LANGUAGE plpgsql;


