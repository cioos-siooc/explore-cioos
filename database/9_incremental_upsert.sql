/*

Incremental mode UPSERT functions

These functions handle the UPSERT operations when running in incremental mode.
They merge data from temporary tables into the main tables.

Functions:
- create_temp_tables() - Create temporary staging tables
- upsert_datasets_from_temp() - UPSERT datasets from temp_datasets
- replace_profiles_from_temp() - Replace profiles for updated datasets
- replace_obis_cells_from_temp() - Replace obis_cells for updated datasets
- replace_trajectory_cells_from_temp() - Replace trajectory_cells for updated datasets
- upsert_skipped_datasets_from_temp() - UPSERT skipped datasets
- process_incremental_update() - Main orchestrator for entire incremental workflow

*/


-- Create temporary tables for incremental mode
-- These mirror the structure of main tables but without constraints
CREATE OR REPLACE FUNCTION create_temp_tables() RETURNS VOID AS $$
BEGIN
  -- Create temp tables with same structure as main tables
  -- EXCLUDING GENERATED: datasets.coverage_bbox is a GENERATED column; LIKE
  -- would copy its expression and reject plain INSERTs. The main-table INSERT
  -- recomputes it from the coverage_* columns.
  CREATE TEMP TABLE IF NOT EXISTS temp_datasets (LIKE cde.datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING GENERATED);
  -- EXCLUDING GENERATED: profiles.bbox is a GENERATED column; LIKE would copy
  -- its expression and reject plain INSERTs. The main-table INSERT recomputes
  -- bbox from the lat/lon min/max columns, so the temp table doesn't carry it.
  CREATE TEMP TABLE IF NOT EXISTS temp_profiles (LIKE cde.profiles INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING GENERATED);
  CREATE TEMP TABLE IF NOT EXISTS temp_skipped_datasets (LIKE cde.skipped_datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  CREATE TEMP TABLE IF NOT EXISTS temp_obis_cells (LIKE cde.obis_cells INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  -- LIKE copies the GENERATED expression for geom, which would reject plain
  -- INSERTs of lat/lon-only rows on some paths; drop the expression so the
  -- temp table takes NULL geom (the main-table INSERT recomputes it anyway).
  CREATE TEMP TABLE IF NOT EXISTS temp_trajectory_cells (LIKE cde.trajectory_cells INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING GENERATED);

  -- Explicitly drop all NOT NULL constraints from temp tables
  -- These are column-level constraints that EXCLUDING CONSTRAINTS doesn't remove
  ALTER TABLE temp_datasets
    ALTER COLUMN dataset_id DROP NOT NULL,
    ALTER COLUMN erddap_url DROP NOT NULL,
    ALTER COLUMN cdm_data_type DROP NOT NULL,
    ALTER COLUMN title DROP NOT NULL,
    ALTER COLUMN organizations DROP NOT NULL,
    ALTER COLUMN eovs DROP NOT NULL,
    ALTER COLUMN n_profiles DROP NOT NULL,
    ALTER COLUMN platform DROP NOT NULL,
    ALTER COLUMN organization_pks DROP NOT NULL;

  ALTER TABLE temp_profiles
    ALTER COLUMN geom DROP NOT NULL,
    ALTER COLUMN dataset_pk DROP NOT NULL,
    ALTER COLUMN erddap_url DROP NOT NULL,
    ALTER COLUMN dataset_id DROP NOT NULL,
    ALTER COLUMN time_min DROP NOT NULL,
    ALTER COLUMN time_max DROP NOT NULL,
    ALTER COLUMN latitude DROP NOT NULL,
    ALTER COLUMN longitude DROP NOT NULL,
    ALTER COLUMN depth_min DROP NOT NULL,
    ALTER COLUMN depth_max DROP NOT NULL,
    ALTER COLUMN n_records DROP NOT NULL,
    ALTER COLUMN point_pk DROP NOT NULL,
    ALTER COLUMN records_per_day DROP NOT NULL;
END;
$$ LANGUAGE plpgsql;


-- UPSERT datasets from temp table into main datasets table
-- Uses (dataset_id, erddap_url) as unique key
CREATE OR REPLACE FUNCTION upsert_datasets_from_temp() RETURNS VOID AS $$
BEGIN
  -- Explicit column list (not SELECT *) because cde.datasets has a GENERATED
  -- coverage_bbox column that temp_datasets omits; pk is left out so the
  -- target assigns its own serial.
  INSERT INTO cde.datasets (
    pk_url, dataset_id, erddap_url, platform, title, title_fr,
    summary, summary_fr, cdm_data_type, organizations, eovs, ckan_id,
    timeseries_id_variable, profile_id_variable, trajectory_id_variable,
    organization_pks, n_profiles, profile_variables, num_columns,
    first_eov_column, source_type, obis_nodes,
    content_hash, content_hash_reason, last_updated_at, verified_at,
    coverage_lat_min, coverage_lat_max, coverage_lon_min, coverage_lon_max,
    coverage_time_min, coverage_time_max, coverage_depth_min, coverage_depth_max,
    grid_variables, grid_dimensions, wms_url
  )
  SELECT
    pk_url, dataset_id, erddap_url, platform, title, title_fr,
    summary, summary_fr, cdm_data_type, organizations, eovs, ckan_id,
    timeseries_id_variable, profile_id_variable, trajectory_id_variable,
    organization_pks, n_profiles, profile_variables, num_columns,
    first_eov_column, source_type, obis_nodes,
    content_hash, content_hash_reason, last_updated_at, verified_at,
    coverage_lat_min, coverage_lat_max, coverage_lon_min, coverage_lon_max,
    coverage_time_min, coverage_time_max, coverage_depth_min, coverage_depth_max,
    grid_variables, grid_dimensions, wms_url
  FROM temp_datasets
  ON CONFLICT (dataset_id, erddap_url)
  DO UPDATE SET
    platform = EXCLUDED.platform,
    title = EXCLUDED.title,
    title_fr = EXCLUDED.title_fr,
    summary = EXCLUDED.summary,
    summary_fr = EXCLUDED.summary_fr,
    cdm_data_type = EXCLUDED.cdm_data_type,
    organizations = EXCLUDED.organizations,
    eovs = EXCLUDED.eovs,
    ckan_id = EXCLUDED.ckan_id,
    timeseries_id_variable = EXCLUDED.timeseries_id_variable,
    profile_id_variable = EXCLUDED.profile_id_variable,
    trajectory_id_variable = EXCLUDED.trajectory_id_variable,
    profile_variables = EXCLUDED.profile_variables,
    num_columns = EXCLUDED.num_columns,
    first_eov_column = EXCLUDED.first_eov_column,
    organization_pks = EXCLUDED.organization_pks,
    n_profiles = EXCLUDED.n_profiles,
    source_type = EXCLUDED.source_type,
    obis_nodes = EXCLUDED.obis_nodes,
    content_hash = EXCLUDED.content_hash,
    content_hash_reason = EXCLUDED.content_hash_reason,
    last_updated_at = EXCLUDED.last_updated_at,
    verified_at = EXCLUDED.verified_at,
    coverage_lat_min = EXCLUDED.coverage_lat_min,
    coverage_lat_max = EXCLUDED.coverage_lat_max,
    coverage_lon_min = EXCLUDED.coverage_lon_min,
    coverage_lon_max = EXCLUDED.coverage_lon_max,
    coverage_time_min = EXCLUDED.coverage_time_min,
    coverage_time_max = EXCLUDED.coverage_time_max,
    coverage_depth_min = EXCLUDED.coverage_depth_min,
    coverage_depth_max = EXCLUDED.coverage_depth_max,
    grid_variables = EXCLUDED.grid_variables,
    grid_dimensions = EXCLUDED.grid_dimensions,
    wms_url = EXCLUDED.wms_url;
END;
$$ LANGUAGE plpgsql;


-- Replace profiles for datasets that are in temp_datasets
-- Deletes old profiles for those datasets, then inserts new ones from temp_profiles
CREATE OR REPLACE FUNCTION replace_profiles_from_temp() RETURNS VOID AS $$
BEGIN
  -- Delete old profiles for updated datasets
  DELETE FROM cde.profiles p
  USING temp_datasets td
  WHERE p.dataset_id = td.dataset_id
    AND p.erddap_url = td.erddap_url;

  -- Insert new profiles from temp table. Explicit column list (not SELECT *)
  -- because cde.profiles has a GENERATED bbox column that temp_profiles omits;
  -- pk is left out so the target assigns its own serial.
  INSERT INTO cde.profiles (
    geom, dataset_pk, erddap_url, dataset_id, timeseries_id, profile_id,
    time_min, time_max, latitude, longitude,
    latitude_min, latitude_max, longitude_min, longitude_max, show_as_point,
    depth_min, depth_max, n_records, records_per_day, n_profiles,
    hex_0_pk, hex_1_pk, point_pk, days
  )
  SELECT
    geom, dataset_pk, erddap_url, dataset_id, timeseries_id, profile_id,
    time_min, time_max, latitude, longitude,
    latitude_min, latitude_max, longitude_min, longitude_max, show_as_point,
    depth_min, depth_max, n_records, records_per_day, n_profiles,
    hex_0_pk, hex_1_pk, point_pk, days
  FROM temp_profiles;
END;
$$ LANGUAGE plpgsql;


-- UPSERT skipped_datasets from temp table
-- Deletes existing entries for those datasets, then inserts new ones
CREATE OR REPLACE FUNCTION upsert_skipped_datasets_from_temp() RETURNS VOID AS $$
BEGIN
  -- Delete existing entries for these datasets
  DELETE FROM cde.skipped_datasets s
  USING temp_skipped_datasets ts
  WHERE s.dataset_id = ts.dataset_id
    AND s.erddap_url = ts.erddap_url;

  -- Insert new entries
  INSERT INTO cde.skipped_datasets
  SELECT * FROM temp_skipped_datasets;
END;
$$ LANGUAGE plpgsql;


-- Replace obis_cells for datasets that are in temp_datasets
-- Deletes old obis_cells for those datasets, then inserts new ones from temp_obis_cells
CREATE OR REPLACE FUNCTION replace_obis_cells_from_temp() RETURNS VOID AS $$
BEGIN
  -- Delete old obis_cells only for updated OBIS datasets
  DELETE FROM cde.obis_cells c
  USING temp_datasets td,
        cde.datasets d
  WHERE c.dataset_id = td.dataset_id
    AND d.dataset_id = td.dataset_id
    AND d.source_type = 'obis';

  -- Insert new obis_cells from temp table. aphia_ids is pre-resolved by the
  -- db-loader from cde.scientific_name_vernaculars at COPY time; carried
  -- through here so the post-load backfill UPDATE sees fewer empty rows.
  INSERT INTO cde.obis_cells (dataset_id, latitude, longitude, scientific_names, aphia_ids, n_records, time_min, time_max, depth_min, depth_max)
  SELECT dataset_id, latitude, longitude, scientific_names, aphia_ids, n_records, time_min, time_max, depth_min, depth_max
  FROM temp_obis_cells
  ON CONFLICT (dataset_id, latitude, longitude) DO UPDATE SET
    scientific_names = EXCLUDED.scientific_names,
    aphia_ids = EXCLUDED.aphia_ids,
    n_records = EXCLUDED.n_records,
    time_min = EXCLUDED.time_min,
    time_max = EXCLUDED.time_max,
    depth_min = EXCLUDED.depth_min,
    depth_max = EXCLUDED.depth_max;
END;
$$ LANGUAGE plpgsql;


-- Replace trajectory_cells for datasets that are in temp_datasets
-- Deletes old cells for those datasets, then inserts new ones from temp
CREATE OR REPLACE FUNCTION replace_trajectory_cells_from_temp() RETURNS VOID AS $$
BEGIN
  DELETE FROM cde.trajectory_cells c
  USING temp_datasets td
  WHERE c.dataset_id = td.dataset_id
    AND c.erddap_url = td.erddap_url;

  -- dataset_pk is resolved here at INSERT time (upsert_datasets_from_temp has
  -- already run) so trajectory_link_dataset_pk() doesn't have to rewrite every
  -- freshly-inserted row afterwards. LEFT JOIN keeps rows whose dataset is
  -- somehow missing; the backfill pass in trajectory_process() catches those.
  INSERT INTO cde.trajectory_cells
    (dataset_pk, erddap_url, dataset_id, trajectory_id, latitude, longitude,
     time_min, time_max, depth_min, depth_max,
     n_records, n_profiles, records_per_day, days)
  SELECT d.pk, t.erddap_url, t.dataset_id, t.trajectory_id, t.latitude, t.longitude,
         t.time_min, t.time_max, t.depth_min, t.depth_max,
         t.n_records, t.n_profiles, t.records_per_day, t.days
  FROM temp_trajectory_cells t
  LEFT JOIN cde.datasets d
    ON d.dataset_id = t.dataset_id AND d.erddap_url = t.erddap_url
  ON CONFLICT (erddap_url, dataset_id, trajectory_id, latitude, longitude) DO UPDATE SET
    dataset_pk = EXCLUDED.dataset_pk,
    time_min = EXCLUDED.time_min,
    time_max = EXCLUDED.time_max,
    depth_min = EXCLUDED.depth_min,
    depth_max = EXCLUDED.depth_max,
    n_records = EXCLUDED.n_records,
    n_profiles = EXCLUDED.n_profiles,
    records_per_day = EXCLUDED.records_per_day,
    days = EXCLUDED.days;
END;
$$ LANGUAGE plpgsql;


-- Main incremental processing function
-- Orchestrates the entire incremental update workflow
CREATE OR REPLACE FUNCTION process_incremental_update() RETURNS VOID AS $$
DECLARE
  has_obis_delta boolean;
BEGIN
  -- 1. Process temp tables to populate computed fields
  PERFORM process_temp_profiles();

  -- 2. UPSERT datasets
  PERFORM upsert_datasets_from_temp();

  -- 3. Replace profiles (delete old, insert new). No constraint toggling: the
  -- backfilled columns are permanently NULL-able and the hex FKs are DEFERRABLE
  -- INITIALLY DEFERRED (validated at COMMIT), so this whole function stays on DML
  -- (ROW EXCLUSIVE) and never takes the ACCESS EXCLUSIVE lock that deadlocked
  -- with live web-api reads. See 7_contraints.sql / validate_loaded_data().
  PERFORM replace_profiles_from_temp();

  -- 5. Replace obis_cells (delete old, insert new)
  PERFORM replace_obis_cells_from_temp();

  -- 6. Replace trajectory_cells (delete old, insert new)
  PERFORM replace_trajectory_cells_from_temp();

  -- 7. UPSERT skipped datasets
  PERFORM upsert_skipped_datasets_from_temp();

  -- 8. Run processing functions to populate remaining fields
  -- Note: cde.points is append-only; profile_process() adds new profile
  -- geometries first, then obis_process()/trajectory_process() add theirs and
  -- backfill point_pk on the rows this load replaced (point pks are stable,
  -- so rows from previous runs keep their links).
  PERFORM ckan_process();
  PERFORM profile_process();

  -- OBIS steps only when this load actually touched OBIS data. The two
  -- scientific-name matviews read only scientific_names/n_records from
  -- obis_cells, so they stay valid whenever no OBIS cells changed — and their
  -- full refresh (~1s+, growing with OBIS volume) was the single largest
  -- fixed cost of a non-OBIS incremental load.
  SELECT EXISTS (SELECT 1 FROM temp_obis_cells)
      OR EXISTS (SELECT 1 FROM temp_datasets td
                 JOIN cde.datasets d ON d.dataset_id = td.dataset_id
                 WHERE d.source_type = 'obis')
    INTO has_obis_delta;
  IF has_obis_delta THEN
    -- obis_process(concurrent_refresh => TRUE, rebuild_indexes => FALSE):
    -- concurrent matview refresh (live readers), and UPDATE aphia_ids in place
    -- rather than DROP/CREATE INDEX. The drop+rebuild is a full-reload
    -- throughput optimization; in incremental it would take ACCESS EXCLUSIVE
    -- on obis_cells (another reader deadlock source) to save work on a small
    -- row set.
    PERFORM obis_process(TRUE, FALSE);
  ELSE
    -- No OBIS delta: links and matviews are already valid. Still run the
    -- aphia backfill (cheap — scoped to cells with empty aphia_ids) so
    -- vernaculars added since the last OBIS load reach obis_cells without
    -- waiting for one; it doesn't touch what the matviews read.
    PERFORM obis_backfill_aphia_ids(FALSE);
  END IF;

  PERFORM trajectory_process();

  -- 9. Create hexes for all data
  PERFORM create_hexes();

  -- 10. Validate that every required column got populated (replaces the old
  -- set_constraints() NOT NULL re-add; a plain SELECT, no ACCESS EXCLUSIVE).
  PERFORM validate_loaded_data();
END;
$$ LANGUAGE plpgsql;


-- Remove datasets that disappeared upstream, giving the incremental path
-- full-reload semantics without the TRUNCATE (whose ACCESS EXCLUSIVE lock
-- blanked the whole site for the duration of a reload).
--
-- Coverage: a harvest run fully enumerates each source it touches — every
-- dataset lands in temp_datasets (changed), temp_verified (skipped as
-- unchanged) or temp_skipped_datasets (errored / filtered out). So a
-- cde.datasets row of a covered source that appears in NONE of the three is
-- gone upstream and can be deleted, along with its profiles/cells rows.
-- Sources absent from this run are never touched, so concurrent per-source
-- harvesters each prune only their own source.
--
-- Guard: if more than max_fraction of a source's datasets would vanish at
-- once, that smells like a harvester bug / partial enumeration rather than a
-- real mass-removal — the source is skipped with a WARNING and nothing is
-- deleted for it. datasets_lookup is intentionally kept (append-only so
-- pk_url stays stable if a dataset returns); orphaned points/hexes/
-- organizations are collected post-commit by gc_orphan_points_and_hexes().
CREATE OR REPLACE FUNCTION prune_stale_datasets(max_fraction float8 DEFAULT 0.5)
RETURNS bigint AS $$
DECLARE
  src record;
  n_db bigint;
  n bigint;
BEGIN
  -- The db-loader creates+fills temp_verified when the harvest reported
  -- unchanged datasets; create it empty here otherwise (also keeps this
  -- function callable against a loader too old to know about it).
  CREATE TEMP TABLE IF NOT EXISTS temp_verified
    (erddap_url text, dataset_id text, verified_at timestamptz);

  DROP TABLE IF EXISTS _prune_candidates;
  CREATE TEMP TABLE _prune_candidates ON COMMIT DROP AS
  SELECT d.pk, d.dataset_id, d.erddap_url, d.source_type
  FROM cde.datasets d
  JOIN (
    SELECT DISTINCT erddap_url FROM (
      SELECT erddap_url FROM temp_datasets
      UNION ALL SELECT erddap_url FROM temp_verified
      UNION ALL SELECT erddap_url FROM temp_skipped_datasets
    ) u WHERE erddap_url IS NOT NULL
  ) covered ON covered.erddap_url = d.erddap_url
  WHERE NOT EXISTS (SELECT 1 FROM temp_datasets t
                    WHERE t.dataset_id = d.dataset_id AND t.erddap_url = d.erddap_url)
    AND NOT EXISTS (SELECT 1 FROM temp_verified v
                    WHERE v.dataset_id = d.dataset_id AND v.erddap_url = d.erddap_url)
    AND NOT EXISTS (SELECT 1 FROM temp_skipped_datasets s
                    WHERE s.dataset_id = d.dataset_id AND s.erddap_url = d.erddap_url);

  FOR src IN SELECT erddap_url, count(*) AS n_stale
             FROM _prune_candidates GROUP BY erddap_url
  LOOP
    SELECT count(*) INTO n_db FROM cde.datasets d
    WHERE d.erddap_url = src.erddap_url;
    IF src.n_stale::float8 / n_db > max_fraction THEN
      RAISE WARNING
        'prune_stale_datasets: refusing to prune %/% dataset(s) of % (exceeds max_fraction %); harvester bug or partial enumeration?',
        src.n_stale, n_db, src.erddap_url, max_fraction;
      DELETE FROM _prune_candidates WHERE erddap_url = src.erddap_url;
    ELSE
      RAISE NOTICE 'prune_stale_datasets: pruning % stale dataset(s) of %',
        src.n_stale, src.erddap_url;
    END IF;
  END LOOP;

  DELETE FROM cde.profiles p USING _prune_candidates c
  WHERE p.dataset_id = c.dataset_id AND p.erddap_url = c.erddap_url;

  DELETE FROM cde.obis_cells o USING _prune_candidates c
  WHERE o.dataset_id = c.dataset_id AND c.source_type = 'obis';

  DELETE FROM cde.trajectory_cells t USING _prune_candidates c
  WHERE t.dataset_id = c.dataset_id AND t.erddap_url = c.erddap_url;

  DELETE FROM cde.skipped_datasets s USING _prune_candidates c
  WHERE s.dataset_id = c.dataset_id AND s.erddap_url = c.erddap_url;

  DELETE FROM cde.datasets d USING _prune_candidates c WHERE d.pk = c.pk;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;
