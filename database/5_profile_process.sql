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


-- Trajectory-cell post-load processing. Mirrors the obis_* functions above:
-- trajectory_cells carries a generated geom, so processing is only the
-- dataset_pk backfill, the points insert and the days backfill. Must run
-- AFTER profile_process() (which rebuilds cde.points) and BEFORE
-- create_hexes() (which links point_pk + hex FKs by joining points on geom).

CREATE OR REPLACE FUNCTION trajectory_link_dataset_pk() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  UPDATE cde.trajectory_cells c
  SET dataset_pk = d.pk
  FROM cde.datasets d
  WHERE c.dataset_id = d.dataset_id
    AND c.erddap_url = d.erddap_url
    AND c.dataset_pk IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION trajectory_insert_points() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO cde.points (geom)
  SELECT src.new_geom
    FROM (
      SELECT DISTINCT
             ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857) AS new_geom
        FROM cde.trajectory_cells
    ) src
    LEFT JOIN cde.points p ON p.geom = src.new_geom
   WHERE p.pk IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- NOTE: there is deliberately no trajectory_link_point_pk(). point_pk is
-- linked together with the hex FKs in create_hexes() (single UPDATE joining
-- cde.points by geom) to avoid rewriting every row of the largest cells
-- table twice per load. The relink covers ALL rows on every run because
-- profile_process() rebuilds cde.points with new serial pks.

CREATE OR REPLACE FUNCTION trajectory_update_days() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  UPDATE cde.trajectory_cells
  SET days = date_part('days', time_max - time_min) + 1
  WHERE days IS NULL
    AND time_min IS NOT NULL AND time_max IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- Track-point post-load processing. trajectory_points carries a generated
-- geom and no point_pk/hex FKs, so processing is only the dataset_pk
-- backfill plus the per-trajectory summary rebuild.

CREATE OR REPLACE FUNCTION trajectory_points_link_dataset_pk() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  UPDATE cde.trajectory_points p
  SET dataset_pk = d.pk
  FROM cde.datasets d
  WHERE p.dataset_id = d.dataset_id
    AND p.erddap_url = d.erddap_url
    AND p.dataset_pk IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- Rebuild cde.trajectory_track_stats from scratch. Cheap (one grouped scan of
-- trajectory_points) and always consistent, so no incremental bookkeeping.
-- DELETE, not TRUNCATE: TRUNCATE takes AccessExclusiveLock, which conflicts
-- with the AccessShareLock every concurrent loader's pre-lock phase holds on
-- this table (create_temp_tables' LIKE) and with web-api readers — a live
-- three-loader deadlock was traced to exactly this statement. DELETE takes
-- RowExclusiveLock and MVCC keeps readers on the old rows until commit; the
-- table is tiny (one row per trajectory), so no TRUNCATE-speed argument.
CREATE OR REPLACE FUNCTION trajectory_refresh_track_stats() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM cde.trajectory_track_stats;
  INSERT INTO cde.trajectory_track_stats
         (dataset_pk, trajectory_id, time_min, time_max, n_points, bbox,
          median_gap_secs)
  SELECT dataset_pk, trajectory_id, min(time), max(time), count(*),
         -- ST_Extent returns a box2d with no SRID; restore 3857 for the column
         ST_SetSRID(ST_Extent(geom)::geometry, 3857),
         -- Median inter-fix gap = the platform's typical reporting cadence,
         -- robust to idle periods (percentile_cont skips each track's NULL
         -- first-row gap). A mean would conflate sailing and idle time: a
         -- vessel sailing a few days per year at ~48min cadence "averages"
         -- to days-to-weeks, which let between-cruise connector chords
         -- through the /tiles/tracks gap splitting.
         percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_secs)
    FROM (
      SELECT dataset_pk, trajectory_id, time, geom,
             extract(epoch FROM time - lag(time) OVER (
               PARTITION BY dataset_pk, trajectory_id ORDER BY time
             )) AS gap_secs
        FROM cde.trajectory_points
       WHERE dataset_pk IS NOT NULL
    ) g
   GROUP BY dataset_pk, trajectory_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- Wrapper used by process_incremental_update(); the full-reload path in the
-- db-loader invokes the sub-functions individually for per-step timing logs.
CREATE OR REPLACE FUNCTION trajectory_process() RETURNS VOID AS $$
BEGIN
  -- dataset_pk is normally set at INSERT time (loader COPY / incremental
  -- upsert both fill it); this pass only backfills rows that missed it.
  PERFORM trajectory_link_dataset_pk();
  PERFORM trajectory_insert_points();
  -- days is computed at harvest time; this pass only backfills NULLs.
  PERFORM trajectory_update_days();
  -- point_pk + hex FKs are linked in create_hexes(), which runs after.
  PERFORM trajectory_points_link_dataset_pk();
  PERFORM trajectory_refresh_track_stats();
END;
$$ LANGUAGE plpgsql;
