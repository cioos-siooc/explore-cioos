/*

profile_process()

 - set profiles columns: geom, dataset_pk, point_pk
 - recreate the points table

process_temp_profiles()

 - processes temp_profiles table during incremental mode
 - contains shared logic with profile_process()

 */


-- Helper function to process geometry and dataset linking
-- Used by both profile_process() and process_temp_profiles()
CREATE OR REPLACE FUNCTION process_profile_geometry_and_links(target_table TEXT) RETURNS VOID AS $$
BEGIN
  -- Set geom from lat/lon
  EXECUTE format('
    UPDATE %I
    SET geom = ST_Transform(
      ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
      3857
    )
    WHERE geom IS NULL
  ', target_table);

  -- Link profiles to datasets via PK
  EXECUTE format('
    UPDATE %I p
    SET dataset_pk = d.pk
    FROM cde.datasets d
    WHERE p.dataset_id = d.dataset_id
      AND p.erddap_url = d.erddap_url
      AND p.dataset_pk IS NULL
  ', target_table);

  -- Calculate days
  EXECUTE format('
    UPDATE %I
    SET days = date_part(''days'', time_max - time_min) + 1
    WHERE days IS NULL
  ', target_table);
END;
$$ LANGUAGE plpgsql;


-- Process temporary profiles table during incremental mode
CREATE OR REPLACE FUNCTION process_temp_profiles() RETURNS VOID AS $$
BEGIN
  PERFORM process_profile_geometry_and_links('temp_profiles');
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION profile_process() RETURNS VOID AS $$
BEGIN
  -- AFTER LOADING PROFILE DATA:

  -- Use shared function for geometry and linking
  -- Set search path to cde schema so the function can find the profiles table
  SET search_path TO cde, public;
  PERFORM process_profile_geometry_and_links('profiles');

  -- Rebuild points table from distinct profile geometries
  DELETE FROM cde.points;

  WITH pp AS (
    SELECT DISTINCT geom FROM cde.profiles
  )
  INSERT INTO cde.points (geom)
  SELECT geom FROM pp;

  UPDATE cde.profiles
  SET point_pk = points.pk
  FROM cde.points
  WHERE points.geom = profiles.geom;

  -- Note: days calculation now handled by process_profile_geometry_and_links()

  -- Set number of profiles per dataset
  WITH profiles_per_dataset AS (
    SELECT d.pk, COUNT(p.pk)
    FROM cde.datasets d
    JOIN cde.profiles p ON p.dataset_pk = d.pk
    GROUP BY d.pk
  )
  UPDATE cde.datasets d
  SET n_profiles = profiles_per_dataset.count
  FROM profiles_per_dataset
  WHERE profiles_per_dataset.pk = d.pk;

  -- Insert any new names; changed/deleted datasets will always be in here
  INSERT INTO cde.organizations_lookup (name)
  SELECT name FROM cde.organizations ON CONFLICT DO NOTHING;

  INSERT INTO cde.datasets_lookup (erddap_url, dataset_id)
  SELECT erddap_url, dataset_id FROM cde.datasets ON CONFLICT DO NOTHING;

  UPDATE cde.datasets
  SET pk_url = datasets_lookup.pk
  FROM cde.datasets_lookup
  WHERE datasets_lookup.erddap_url = datasets.erddap_url
    AND datasets_lookup.dataset_id = datasets.dataset_id;

END;
$$ LANGUAGE plpgsql;


-- Drop the previous 0-argument signature, if present from an earlier deploy.
-- CREATE OR REPLACE FUNCTION only matches an existing definition by exact
-- signature, so without this the old slow obis_process() would coexist with
-- the new 1-arg version and incremental callers would still pick it up.
DROP FUNCTION IF EXISTS obis_process();

CREATE OR REPLACE FUNCTION obis_process(concurrent_refresh BOOLEAN DEFAULT TRUE) RETURNS VOID AS $$
BEGIN
  SET search_path TO cde, public;

  -- Set geom from lat/lon
  UPDATE obis_cells
  SET geom = ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)
  WHERE geom IS NULL;

  -- Link to datasets
  UPDATE obis_cells c
  SET dataset_pk = d.pk
  FROM datasets d
  WHERE c.dataset_id = d.dataset_id
    AND d.source_type = 'obis'
    AND c.dataset_pk IS NULL;

  -- Insert distinct geometries into points (skip existing).
  -- LEFT JOIN anti-join over the distinct lat/lon set computes geom once per
  -- distinct point instead of inside a correlated subquery for every candidate.
  INSERT INTO points (geom)
  SELECT src.new_geom
    FROM (
      SELECT DISTINCT
             ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857) AS new_geom
        FROM obis_cells
    ) src
    LEFT JOIN points p ON p.geom = src.new_geom
   WHERE p.pk IS NULL;

  -- Link obis_cells to point_pk
  UPDATE obis_cells
  SET point_pk = points.pk
  FROM points
  WHERE points.geom = obis_cells.geom
    AND obis_cells.point_pk IS NULL;

  -- Update n_profiles on datasets to reflect obis_cells count
  UPDATE datasets d
  SET n_profiles = (SELECT count(*) FROM obis_cells c WHERE c.dataset_pk = d.pk)
  WHERE d.source_type = 'obis';

  -- Matview refreshes. CONCURRENTLY costs ~2x and is only needed when readers
  -- might be hitting the matview during the refresh; on a full rebuild after
  -- TRUNCATE there are none. The caller passes FALSE on full rebuild and lets
  -- the default TRUE apply for incremental (process_incremental_update path).
  IF concurrent_refresh THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY cde.obis_scientific_names;
    REFRESH MATERIALIZED VIEW CONCURRENTLY cde.obis_scientific_name_popularity;
  ELSE
    REFRESH MATERIALIZED VIEW cde.obis_scientific_names;
    REFRESH MATERIALIZED VIEW cde.obis_scientific_name_popularity;
  END IF;

  -- Backfill obis_cells.aphia_ids from the latest scientific_name_vernaculars
  -- mappings so the rank-aware filter rolldown can use integer-set overlap.
  -- Runs only over cells that haven't been resolved yet (or whose name list
  -- changed). For names not yet in scientific_name_vernaculars (e.g. species
  -- new to this harvest, before populate_vernaculars.py has caught up), the
  -- COALESCE leaves aphia_ids as the default '{}' and those cells fall back
  -- to literal-name matching in dbFilter.js until the next vernacular populate
  -- + reprocess.
  --
  -- Performance: the GIN index on aphia_ids is dropped before the bulk UPDATE
  -- and rebuilt after; rewriting it from scratch is much faster than 100K+
  -- incremental insertions. The UPDATE itself is rewritten as a single
  -- hash-join via two CTEs (cell_names → cell_aphias) instead of a per-row
  -- correlated subquery.
  DROP INDEX IF EXISTS cde.obis_cells_aphia_ids_gin;

  WITH cell_names AS (
    SELECT pk, unnest(scientific_names) AS sn
      FROM cde.obis_cells
     WHERE scientific_names IS NOT NULL
       AND coalesce(array_length(scientific_names, 1), 0) > 0
       AND coalesce(array_length(aphia_ids, 1), 0) = 0
  ),
  cell_aphias AS (
    SELECT cn.pk, array_agg(DISTINCT v.aphia_id) AS aphia_ids
      FROM cell_names cn
      JOIN cde.scientific_name_vernaculars v ON v.scientific_name = cn.sn
     WHERE v.aphia_id IS NOT NULL
     GROUP BY cn.pk
  )
  UPDATE cde.obis_cells c
     SET aphia_ids = COALESCE(ca.aphia_ids, '{}'::integer[])
    FROM cell_aphias ca
   WHERE c.pk = ca.pk;

  CREATE INDEX obis_cells_aphia_ids_gin
    ON cde.obis_cells USING GIN (aphia_ids);

END;
$$ LANGUAGE plpgsql;
