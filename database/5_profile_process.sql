/*

profile_process()

 - set profiles columns: geom, dataset_pk, point_pk
 - add new profile geometries to the append-only points table

process_temp_profiles()

 - processes temp_profiles table during incremental mode
 - contains shared logic with profile_process()

gc_orphan_points_and_hexes()

 - out-of-band cleanup of points/hex cells nothing references any more

 cde.points is append-only with UNIQUE (geom) as its identity: loads insert
 geometries not seen before and NEVER delete or renumber, so point pks are
 stable across runs and every "relink point_pk" pass below is scoped to
 point_pk IS NULL — proportional to the delta, not the table. Rows orphaned
 by shrinking/removed datasets are collected by gc_orphan_points_and_hexes(),
 which the db-loader runs post-commit, outside the load transaction.

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

  -- Append geometries not seen before; never delete or renumber (see file
  -- header). Only unlinked profiles can contribute new geometries, so the
  -- scan is delta-sized; the anti-join skips existing points and ON CONFLICT
  -- guards the unique (geom) identity.
  INSERT INTO cde.points (geom)
  SELECT src.geom
  FROM (
    SELECT DISTINCT geom FROM cde.profiles
    WHERE point_pk IS NULL AND geom IS NOT NULL
  ) src
  LEFT JOIN cde.points p ON p.geom = src.geom
  WHERE p.pk IS NULL
  ON CONFLICT (geom) DO NOTHING;

  UPDATE cde.profiles
  SET point_pk = points.pk
  FROM cde.points
  WHERE points.geom = profiles.geom
    AND profiles.point_pk IS NULL;

  -- Note: days calculation now handled by process_profile_geometry_and_links()

  -- Set number of profiles per dataset. IS DISTINCT FROM: only write rows
  -- whose count actually changed — an unguarded UPDATE rewrites every dataset
  -- row (dead tuples + WAL) on every load, even a no-op one.
  WITH profiles_per_dataset AS (
    SELECT d.pk, COUNT(p.pk)
    FROM cde.datasets d
    JOIN cde.profiles p ON p.dataset_pk = d.pk
    GROUP BY d.pk
  )
  UPDATE cde.datasets d
  SET n_profiles = profiles_per_dataset.count
  FROM profiles_per_dataset
  WHERE profiles_per_dataset.pk = d.pk
    AND d.n_profiles IS DISTINCT FROM profiles_per_dataset.count;

  -- Insert any new names; changed/deleted datasets will always be in here
  INSERT INTO cde.organizations_lookup (name)
  SELECT name FROM cde.organizations ON CONFLICT DO NOTHING;

  INSERT INTO cde.datasets_lookup (erddap_url, dataset_id)
  SELECT erddap_url, dataset_id FROM cde.datasets ON CONFLICT DO NOTHING;

  UPDATE cde.datasets
  SET pk_url = datasets_lookup.pk
  FROM cde.datasets_lookup
  WHERE datasets_lookup.erddap_url = datasets.erddap_url
    AND datasets_lookup.dataset_id = datasets.dataset_id
    AND datasets.pk_url IS DISTINCT FROM datasets_lookup.pk;

END;
$$ LANGUAGE plpgsql;


-- OBIS post-load processing, split into per-step functions so the db-loader
-- can time each step individually and surface row counts in logs. The wrapper
-- obis_process() at the bottom preserves the previous calling convention used
-- by process_incremental_update().
--
-- Drop earlier signatures if present from a prior deploy, so the new overloads
-- below (obis_process gained a rebuild_indexes arg; obis_backfill_aphia_ids
-- gained one too) replace them instead of coexisting as ambiguous overloads.
DROP FUNCTION IF EXISTS obis_process();
DROP FUNCTION IF EXISTS obis_process(BOOLEAN);
DROP FUNCTION IF EXISTS obis_backfill_aphia_ids();


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
-- of inside a correlated subquery for every candidate. Only unlinked cells
-- (rows this load replaced) can contribute new geometries — linked rows have
-- theirs in cde.points already — so the DISTINCT+transform runs over the
-- delta, not the whole table.
CREATE OR REPLACE FUNCTION obis_insert_points() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO cde.points (geom)
  SELECT src.new_geom
    FROM (
      SELECT DISTINCT
             ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857) AS new_geom
        FROM cde.obis_cells
       WHERE point_pk IS NULL
    ) src
    LEFT JOIN cde.points p ON p.geom = src.new_geom
   WHERE p.pk IS NULL
  ON CONFLICT (geom) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION obis_link_point_pk() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  -- Points are append-only with stable pks (see 5_profile_process.sql header),
  -- so existing links stay valid across runs and only rows that never got one
  -- (freshly replaced cells) need the geom match — a delta-sized backfill.
  UPDATE cde.obis_cells c
  SET point_pk = p.pk
  FROM cde.points p
  WHERE p.geom = c.geom
    AND c.point_pk IS NULL;
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
    AND d.source_type = 'obis'
    AND d.n_profiles IS DISTINCT FROM counts.c;
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
-- Performance: on a full reload the GIN index on aphia_ids is dropped before the
-- bulk UPDATE and rebuilt after — rewriting it from scratch is much faster than
-- 100K+ incremental insertions. The UPDATE itself is a single hash-join via two
-- CTEs (cell_names → cell_aphias) instead of a per-row correlated subquery.
--
-- rebuild_indexes: pass FALSE from the incremental path. DROP INDEX takes an
-- ACCESS EXCLUSIVE lock on cde.obis_cells, which deadlocks with live web-api
-- reads (the same class of bug as the old constraint DDL); incremental touches
-- few rows, so updating with the GIN in place is cheap and lock-safe. The
-- partial scientific_names GIN is maintained automatically by Postgres as rows
-- gain aphia_ids, so it needs no manual rebuild in that mode either.
CREATE OR REPLACE FUNCTION obis_backfill_aphia_ids(rebuild_indexes BOOLEAN DEFAULT TRUE) RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  IF rebuild_indexes THEN
    DROP INDEX IF EXISTS cde.obis_cells_aphia_ids_gin;
  END IF;

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

  IF rebuild_indexes THEN
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
  END IF;

  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- Wrapper preserved for incremental callers (process_incremental_update calls
-- obis_process() directly). Full-reload path in db-loader/__main__.py invokes
-- the sub-functions individually so each gets its own _timed log line.
-- rebuild_indexes is forwarded to obis_backfill_aphia_ids(): the incremental
-- caller (process_incremental_update) passes FALSE to avoid the ACCESS EXCLUSIVE
-- DROP INDEX against live readers; full reloads leave it TRUE.
CREATE OR REPLACE FUNCTION obis_process(
  concurrent_refresh BOOLEAN DEFAULT TRUE,
  rebuild_indexes BOOLEAN DEFAULT TRUE
) RETURNS VOID AS $$
BEGIN
  PERFORM obis_set_geom();
  PERFORM obis_link_dataset_pk();
  PERFORM obis_insert_points();
  PERFORM obis_link_point_pk();
  PERFORM obis_update_n_profiles();
  PERFORM obis_refresh_matviews(concurrent_refresh);
  PERFORM obis_backfill_aphia_ids(rebuild_indexes);
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


-- Same delta-scoping as obis_insert_points(): only unlinked rows can carry
-- geometries not yet in cde.points, and trajectory_cells is the largest cells
-- table, so the WHERE keeps this from re-scanning ~800k rows per load.
CREATE OR REPLACE FUNCTION trajectory_insert_points() RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO cde.points (geom)
  SELECT src.new_geom
    FROM (
      SELECT DISTINCT
             ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857) AS new_geom
        FROM cde.trajectory_cells
       WHERE point_pk IS NULL
    ) src
    LEFT JOIN cde.points p ON p.geom = src.new_geom
   WHERE p.pk IS NULL
  ON CONFLICT (geom) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;


-- NOTE: there is deliberately no trajectory_link_point_pk(). point_pk is
-- linked together with the hex FKs in create_hexes() (single UPDATE joining
-- cde.points by geom) to avoid rewriting every row of the largest cells
-- table twice per load. Points are append-only with stable pks, so that
-- relink only touches rows still missing a link — freshly replaced cells.

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
END;
$$ LANGUAGE plpgsql;


-- Out-of-band garbage collection for the append-only points/hexes tables:
-- points nothing references any more (datasets removed or reshaped), then hex
-- cells no remaining row references. The db-loader runs this post-commit in
-- its own short transaction under the loader advisory lock (try-lock, skipped
-- when another load is queued), so it never extends a load transaction and
-- never races another loader's linking phase. Leftover rows are invisible to
-- tile/legend queries meanwhile — those only reach points/hexes via the FKs
-- on profiles/obis_cells/trajectory_cells.
CREATE OR REPLACE FUNCTION gc_orphan_points_and_hexes() RETURNS bigint AS $$
DECLARE
  n bigint;
  total bigint := 0;
BEGIN
  DELETE FROM cde.points p
  WHERE NOT EXISTS (SELECT 1 FROM cde.profiles f WHERE f.point_pk = p.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.obis_cells o WHERE o.point_pk = p.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.trajectory_cells t WHERE t.point_pk = p.pk);
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM cde.hexes_zoom_0 h
  WHERE NOT EXISTS (SELECT 1 FROM cde.points x WHERE x.hex_0_pk = h.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.profiles x WHERE x.hex_0_pk = h.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.obis_cells x WHERE x.hex_0_pk = h.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.trajectory_cells x WHERE x.hex_0_pk = h.pk);
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  DELETE FROM cde.hexes_zoom_1 h
  WHERE NOT EXISTS (SELECT 1 FROM cde.points x WHERE x.hex_1_pk = h.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.profiles x WHERE x.hex_1_pk = h.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.obis_cells x WHERE x.hex_1_pk = h.pk)
    AND NOT EXISTS (SELECT 1 FROM cde.trajectory_cells x WHERE x.hex_1_pk = h.pk);
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  -- Organizations no dataset mentions any more (left behind when
  -- prune_stale_datasets() removed their last dataset). organizations_lookup
  -- is kept append-only, so a returning org gets its old pk_url back.
  DELETE FROM cde.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM cde.datasets d WHERE o.name = ANY(d.organizations)
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  RETURN total;
END;
$$ LANGUAGE plpgsql;
