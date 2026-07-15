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


-- OBIS post-load processing, split into per-step functions so the db-loader
-- can time each step individually and surface row counts in logs. The wrapper
-- obis_process() at the bottom preserves the previous calling convention used
-- by process_incremental_update().
--
-- Drop the previous 0-arg signature if present from an earlier deploy. Without
-- this the old single-shot obis_process() can coexist with the wrapper.
DROP FUNCTION IF EXISTS obis_process();


-- geom is now a GENERATED ALWAYS AS … STORED column on obis_cells (computed
-- at INSERT time from latitude/longitude). The previous full-table UPDATE
-- rewrote every row + every index entry; the generated column eliminates
-- that pass entirely. Kept as a no-op so the loader's per-step list and the
-- back-compat wrapper continue to work.
CREATE OR REPLACE FUNCTION obis_set_geom() RETURNS bigint AS $$
BEGIN
  RETURN 0;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION obis_link_dataset_pk() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  UPDATE cde.obis_cells c
  SET dataset_pk = d.pk
  FROM cde.datasets d
  WHERE c.dataset_id = d.dataset_id
    AND d.source_type = 'obis'
    AND c.dataset_pk IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- Insert distinct geometries into points (skip existing). LEFT JOIN anti-join
-- over the distinct lat/lon set computes geom once per distinct point instead
-- of inside a correlated subquery for every candidate.
CREATE OR REPLACE FUNCTION obis_insert_points() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO cde.points (geom)
  SELECT src.new_geom
    FROM (
      SELECT DISTINCT
             ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857) AS new_geom
        FROM cde.obis_cells
    ) src
    LEFT JOIN cde.points p ON p.geom = src.new_geom
   WHERE p.pk IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION obis_link_point_pk() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  -- Relink ALL obis_cells by geom, not just rows where point_pk IS NULL.
  -- profile_process() rebuilds cde.points (DELETE + reinsert with new serial
  -- pks) on every run, so any incremental harvest of a non-OBIS source orphans
  -- the existing obis_cells.point_pk. Re-matching every row by geom keeps the
  -- FK valid (mirrors how profiles are relinked in profile_process()).
  UPDATE cde.obis_cells c
  SET point_pk = p.pk
  FROM cde.points p
  WHERE p.geom = c.geom;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- Single GROUP BY scan over obis_cells, then JOIN-update datasets — replaces
-- a per-dataset correlated subquery that re-scanned obis_cells N times.
CREATE OR REPLACE FUNCTION obis_update_n_profiles() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  WITH counts AS (
    SELECT dataset_pk, count(*) AS c
    FROM cde.obis_cells
    WHERE dataset_pk IS NOT NULL
    GROUP BY dataset_pk
  )
  UPDATE cde.datasets d
  SET n_profiles = counts.c
  FROM counts
  WHERE d.pk = counts.dataset_pk
    AND d.source_type = 'obis';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- CONCURRENTLY costs ~2x and is only needed when readers might be hitting the
-- matview during the refresh; on a full rebuild after TRUNCATE there are none.
-- Caller passes FALSE on full rebuild; default TRUE applies for incremental.
CREATE OR REPLACE FUNCTION obis_refresh_matviews(concurrent_refresh BOOLEAN DEFAULT TRUE) RETURNS bigint AS $$
BEGIN
  IF concurrent_refresh THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY cde.obis_scientific_names;
    REFRESH MATERIALIZED VIEW CONCURRENTLY cde.obis_scientific_name_popularity;
  ELSE
    REFRESH MATERIALIZED VIEW cde.obis_scientific_names;
    REFRESH MATERIALIZED VIEW cde.obis_scientific_name_popularity;
  END IF;
  RETURN 0;
END;
$$ LANGUAGE plpgsql;


-- Backfill obis_cells.aphia_ids from scientific_name_vernaculars so the
-- rank-aware filter rolldown can use integer-set overlap. Names not yet in
-- vernaculars (species new to this harvest, before populate_vernaculars.py
-- catches up) leave aphia_ids as default '{}' and fall back to literal-name
-- matching in dbFilter.js until the next vernacular populate + reprocess.
--
-- Performance: the GIN index on aphia_ids is dropped before the bulk UPDATE
-- and rebuilt after — rewriting it from scratch is much faster than 100K+
-- incremental insertions. The UPDATE itself is a single hash-join via two
-- CTEs (cell_names → cell_aphias) instead of a per-row correlated subquery.
CREATE OR REPLACE FUNCTION obis_backfill_aphia_ids() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
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
  GET DIAGNOSTICS n = ROW_COUNT;

  CREATE INDEX obis_cells_aphia_ids_gin
    ON cde.obis_cells USING GIN (aphia_ids);

  -- Partial scientific_names GIN: only indexes cells whose aphia_ids are
  -- still empty (the literal-name fallback in dbFilter.js is the only path
  -- that uses this index; once aphia_ids is populated, the integer-set GIN
  -- covers the filter). Drop+rebuild keeps the partial predicate consistent
  -- with the rows that just got their aphia_ids set above.
  DROP INDEX IF EXISTS cde.obis_cells_scientific_names_gin;
  CREATE INDEX obis_cells_scientific_names_gin
    ON cde.obis_cells USING GIN (scientific_names)
    WHERE coalesce(array_length(aphia_ids, 1), 0) = 0;

  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- Wrapper preserved for incremental callers (process_incremental_update calls
-- obis_process() directly). Full-reload path in db-loader/__main__.py invokes
-- the sub-functions individually so each gets its own _timed log line.
CREATE OR REPLACE FUNCTION obis_process(concurrent_refresh BOOLEAN DEFAULT TRUE) RETURNS VOID AS $$
BEGIN
  PERFORM obis_set_geom();
  PERFORM obis_link_dataset_pk();
  PERFORM obis_insert_points();
  PERFORM obis_link_point_pk();
  PERFORM obis_update_n_profiles();
  PERFORM obis_refresh_matviews(concurrent_refresh);
  PERFORM obis_backfill_aphia_ids();
END;
$$ LANGUAGE plpgsql;
