/*

Incremental mode: merge data from temporary staging tables into the main tables.

*/


CREATE OR REPLACE FUNCTION create_temp_tables() RETURNS VOID AS $$
BEGIN
  -- EXCLUDING GENERATED: LIKE would copy generated expressions (coverage_bbox,
  -- profiles.bbox) and reject plain INSERTs; the main-table INSERT recomputes them.
  CREATE TEMP TABLE IF NOT EXISTS temp_datasets (LIKE cde.datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING GENERATED);
  CREATE TEMP TABLE IF NOT EXISTS temp_profiles (LIKE cde.profiles INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING GENERATED);
  CREATE TEMP TABLE IF NOT EXISTS temp_skipped_datasets (LIKE cde.skipped_datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  CREATE TEMP TABLE IF NOT EXISTS temp_obis_cells (LIKE cde.obis_cells INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  CREATE TEMP TABLE IF NOT EXISTS temp_trajectory_days (LIKE cde.trajectory_days INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  ALTER TABLE temp_trajectory_days
    ALTER COLUMN day DROP NOT NULL;
  CREATE TEMP TABLE IF NOT EXISTS temp_trajectory_points (LIKE cde.trajectory_points INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING GENERATED);
  ALTER TABLE temp_trajectory_points
    ALTER COLUMN time DROP NOT NULL;

  -- EXCLUDING CONSTRAINTS doesn't remove column-level NOT NULL.
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


CREATE OR REPLACE FUNCTION upsert_datasets_from_temp() RETURNS VOID AS $$
BEGIN
  -- Explicit column list (not SELECT *) because cde.datasets has a GENERATED
  -- coverage_bbox column that temp_datasets omits; pk is left out so the
  -- target assigns its own serial.
  INSERT INTO cde.datasets (
    pk_url, dataset_id, erddap_url, platform, platform_category, title, title_fr,
    summary, summary_fr, cdm_data_type, organizations, eovs, ckan_id,
    timeseries_id_variable, profile_id_variable, trajectory_id_variable,
    organization_pks, n_profiles, profile_variables, num_columns,
    first_eov_column, source_type, obis_nodes,
    content_hash, content_hash_reason, last_updated_at, verified_at,
    coverage_lat_min, coverage_lat_max, coverage_lon_min, coverage_lon_max,
    coverage_time_min, coverage_time_max, coverage_depth_min, coverage_depth_max,
    table_variables, grid_variables, grid_dimensions, wms_url, metadata,
    cdm_altitude_proxy
  )
  SELECT
    pk_url, dataset_id, erddap_url, platform, platform_category, title, title_fr,
    summary, summary_fr, cdm_data_type, organizations, eovs, ckan_id,
    timeseries_id_variable, profile_id_variable, trajectory_id_variable,
    organization_pks, n_profiles, profile_variables, num_columns,
    first_eov_column, source_type, obis_nodes,
    content_hash, content_hash_reason, last_updated_at, verified_at,
    coverage_lat_min, coverage_lat_max, coverage_lon_min, coverage_lon_max,
    coverage_time_min, coverage_time_max, coverage_depth_min, coverage_depth_max,
    table_variables, grid_variables, grid_dimensions, wms_url, metadata,
    cdm_altitude_proxy
  FROM temp_datasets
  ON CONFLICT (dataset_id, erddap_url)
  DO UPDATE SET
    platform = EXCLUDED.platform,
    platform_category = EXCLUDED.platform_category,
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
    table_variables = EXCLUDED.table_variables,
    grid_variables = EXCLUDED.grid_variables,
    grid_dimensions = EXCLUDED.grid_dimensions,
    wms_url = EXCLUDED.wms_url,
    metadata = EXCLUDED.metadata,
    cdm_altitude_proxy = EXCLUDED.cdm_altitude_proxy;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION replace_profiles_from_temp() RETURNS VOID AS $$
BEGIN
  DELETE FROM cde.profiles p
  USING temp_datasets td
  WHERE p.dataset_id = td.dataset_id
    AND p.erddap_url = td.erddap_url;

  -- Explicit column list (not SELECT *) because cde.profiles has a GENERATED
  -- bbox column that temp_profiles omits; pk is left out so the target assigns
  -- its own serial.
  INSERT INTO cde.profiles (
    geom, dataset_pk, erddap_url, dataset_id, timeseries_id, profile_id,
    time_min, time_max, latitude, longitude,
    latitude_min, latitude_max, longitude_min, longitude_max, show_as_point,
    depth_min, depth_max, n_records, records_per_day, n_profiles, eovs,
    hex_0_pk, hex_1_pk, point_pk, days, day_ranges
  )
  SELECT
    geom, dataset_pk, erddap_url, dataset_id, timeseries_id, profile_id,
    time_min, time_max, latitude, longitude,
    latitude_min, latitude_max, longitude_min, longitude_max, show_as_point,
    depth_min, depth_max, n_records, records_per_day, n_profiles, eovs,
    hex_0_pk, hex_1_pk, point_pk, days, day_ranges
  FROM temp_profiles;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION upsert_skipped_datasets_from_temp() RETURNS VOID AS $$
BEGIN
  DELETE FROM cde.skipped_datasets s
  USING temp_skipped_datasets ts
  WHERE s.dataset_id = ts.dataset_id
    AND s.erddap_url = ts.erddap_url;

  INSERT INTO cde.skipped_datasets
  SELECT * FROM temp_skipped_datasets;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION replace_obis_cells_from_temp() RETURNS VOID AS $$
BEGIN
  DELETE FROM cde.obis_cells c
  USING temp_datasets td,
        cde.datasets d
  WHERE c.dataset_id = td.dataset_id
    AND d.dataset_id = td.dataset_id
    AND d.source_type = 'obis';

  -- aphia_ids is pre-resolved by the db-loader at COPY time, so the post-load
  -- backfill UPDATE sees fewer empty rows.
  INSERT INTO cde.obis_cells (dataset_id, latitude, longitude, scientific_names, aphia_ids, n_records, days, day_ranges, time_min, time_max, depth_min, depth_max)
  SELECT dataset_id, latitude, longitude, scientific_names, aphia_ids, n_records, days, day_ranges, time_min, time_max, depth_min, depth_max
  FROM temp_obis_cells
  ON CONFLICT (dataset_id, latitude, longitude) DO UPDATE SET
    scientific_names = EXCLUDED.scientific_names,
    aphia_ids = EXCLUDED.aphia_ids,
    n_records = EXCLUDED.n_records,
    days = EXCLUDED.days,
    day_ranges = EXCLUDED.day_ranges,
    time_min = EXCLUDED.time_min,
    time_max = EXCLUDED.time_max,
    depth_min = EXCLUDED.depth_min,
    depth_max = EXCLUDED.depth_max;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION replace_trajectory_days_from_temp() RETURNS VOID AS $$
BEGIN
  DELETE FROM cde.trajectory_days c
  USING temp_datasets td
  WHERE c.dataset_id = td.dataset_id
    AND c.erddap_url = td.erddap_url;

  -- dataset_pk is resolved at INSERT time so trajectory_link_dataset_pk()
  -- doesn't have to rewrite every fresh row. LEFT JOIN keeps rows whose dataset
  -- is somehow missing; the backfill pass in trajectory_process() catches those.
  INSERT INTO cde.trajectory_days
    (dataset_pk, erddap_url, dataset_id, trajectory_id, day,
     n_records, n_profiles, depth_min, depth_max)
  SELECT d.pk, t.erddap_url, t.dataset_id, t.trajectory_id, t.day,
         t.n_records, t.n_profiles, t.depth_min, t.depth_max
  FROM temp_trajectory_days t
  LEFT JOIN cde.datasets d
    ON d.dataset_id = t.dataset_id AND d.erddap_url = t.erddap_url
  WHERE t.day IS NOT NULL
  ON CONFLICT (erddap_url, dataset_id, trajectory_id, day) DO UPDATE SET
    dataset_pk = EXCLUDED.dataset_pk,
    n_records = EXCLUDED.n_records,
    n_profiles = EXCLUDED.n_profiles,
    depth_min = EXCLUDED.depth_min,
    depth_max = EXCLUDED.depth_max;
END;
$$ LANGUAGE plpgsql;


-- Unlike the other tables, the DELETE is scoped to datasets that actually
-- shipped NEW track points this run: track extraction is best-effort, and a
-- transient failure must not wipe the dataset's existing track (its map
-- coverage is swept from it).
CREATE OR REPLACE FUNCTION replace_trajectory_points_from_temp() RETURNS VOID AS $$
BEGIN
  DELETE FROM cde.trajectory_points p
  USING (SELECT DISTINCT dataset_id, erddap_url FROM temp_trajectory_points) tp
  WHERE p.dataset_id = tp.dataset_id
    AND p.erddap_url = tp.erddap_url;

  INSERT INTO cde.trajectory_points
    (dataset_pk, erddap_url, dataset_id, trajectory_id, profile_id,
     time, latitude, longitude)
  SELECT d.pk, t.erddap_url, t.dataset_id, t.trajectory_id, t.profile_id,
         t.time, t.latitude, t.longitude
  FROM temp_trajectory_points t
  LEFT JOIN cde.datasets d
    ON d.dataset_id = t.dataset_id AND d.erddap_url = t.erddap_url
  WHERE t.time IS NOT NULL
  ON CONFLICT (erddap_url, dataset_id, trajectory_id, time) DO UPDATE SET
    dataset_pk = EXCLUDED.dataset_pk,
    profile_id = EXCLUDED.profile_id,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION process_incremental_update() RETURNS VOID AS $$
DECLARE
  has_obis_delta boolean;
  traj_delta_pks integer[];
BEGIN
  PERFORM process_temp_profiles();

  PERFORM upsert_datasets_from_temp();

  -- Stays on DML (ROW EXCLUSIVE) throughout: an ACCESS EXCLUSIVE lock would
  -- deadlock with live web-api reads. See 7_constraints.sql.
  PERFORM replace_profiles_from_temp();

  PERFORM replace_obis_cells_from_temp();

  PERFORM replace_trajectory_days_from_temp();

  PERFORM replace_trajectory_points_from_temp();

  PERFORM upsert_skipped_datasets_from_temp();

  PERFORM ckan_process();
  PERFORM profile_process();

  -- OBIS steps only when this load touched OBIS data: the matviews stay valid
  -- otherwise, and their refresh (~1s+) dominates a non-OBIS incremental load.
  SELECT EXISTS (SELECT 1 FROM temp_obis_cells)
      OR EXISTS (SELECT 1 FROM temp_datasets td
                 JOIN cde.datasets d ON d.dataset_id = td.dataset_id
                 WHERE d.source_type = 'obis')
    INTO has_obis_delta;
  IF has_obis_delta THEN
    -- concurrent_refresh => TRUE, rebuild_indexes => FALSE: both avoid
    -- ACCESS EXCLUSIVE against live readers.
    PERFORM obis_process(TRUE, FALSE);
  ELSE
    -- Still run the cheap aphia backfill so vernaculars added since the last
    -- OBIS load reach obis_cells without waiting for one.
    PERFORM obis_backfill_aphia_ids(FALSE);
  END IF;

  -- Same steps as trajectory_process(), but the hex sweep is scoped to the
  -- datasets this load touched to avoid a whole-corpus re-sweep.
  PERFORM trajectory_link_dataset_pk();
  PERFORM trajectory_points_link_dataset_pk();
  PERFORM trajectory_refresh_track_stats();

  SELECT array_agg(DISTINCT d.pk) INTO traj_delta_pks
    FROM cde.datasets d
   WHERE EXISTS (SELECT 1 FROM temp_trajectory_points t
                  WHERE t.dataset_id = d.dataset_id AND t.erddap_url = d.erddap_url)
      OR EXISTS (SELECT 1 FROM temp_trajectory_days t
                  WHERE t.dataset_id = d.dataset_id AND t.erddap_url = d.erddap_url);
  IF traj_delta_pks IS NOT NULL THEN
    PERFORM trajectory_build_hexes(traj_delta_pks);
  END IF;

  PERFORM create_hexes();

  PERFORM validate_loaded_data();
END;
$$ LANGUAGE plpgsql;


-- Remove datasets that disappeared upstream, giving the incremental path
-- full-reload semantics without a TRUNCATE (whose ACCESS EXCLUSIVE lock blanks
-- the site).
--
-- A harvest run fully enumerates each source it touches: every dataset lands in
-- temp_datasets, temp_verified or temp_skipped_datasets, so a covered source's
-- row in none of them is gone upstream. A NO_PROFILES_FOUND skip is not
-- protection (it would count in /datasets with nothing on the map), but its
-- skipped_datasets row is kept so the reason stays on record. Sources absent
-- from this run are never touched, so per-source harvesters prune only their own.
--
-- Guard: if more than max_fraction of a source's datasets would vanish at once,
-- that smells like partial enumeration; the source is skipped with a WARNING.
-- datasets_lookup is kept append-only so pk_url stays stable if a dataset
-- returns.
CREATE OR REPLACE FUNCTION prune_stale_datasets(max_fraction float8 DEFAULT 0.5)
RETURNS bigint AS $$
DECLARE
  src record;
  n_db bigint;
  n bigint;
BEGIN
  -- The db-loader creates+fills temp_verified only when the harvest reported
  -- unchanged datasets.
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
                    WHERE s.dataset_id = d.dataset_id AND s.erddap_url = d.erddap_url
                      AND s.reason_code IS DISTINCT FROM 'NO_PROFILES_FOUND');

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

  DELETE FROM cde.trajectory_days t USING _prune_candidates c
  WHERE t.dataset_id = c.dataset_id AND t.erddap_url = c.erddap_url;

  -- trajectory_hexes is keyed on dataset_pk and has an FK to datasets(pk), so
  -- it must be cleared before the datasets DELETE below.
  DELETE FROM cde.trajectory_hexes h USING _prune_candidates c
  WHERE h.dataset_pk = c.pk;

  -- trajectory_points has an FK to datasets(pk), so it must be cleared before
  -- the datasets DELETE below.
  DELETE FROM cde.trajectory_points t USING _prune_candidates c
  WHERE t.dataset_id = c.dataset_id AND t.erddap_url = c.erddap_url;

  -- trajectory_track_stats has no FK but would leave orphans in the
  -- /trajectories/platforms list.
  DELETE FROM cde.trajectory_track_stats s USING _prune_candidates c
  WHERE s.dataset_pk = c.pk;

  DELETE FROM cde.skipped_datasets s USING _prune_candidates c
  WHERE s.dataset_id = c.dataset_id AND s.erddap_url = c.erddap_url
    AND NOT EXISTS (SELECT 1 FROM temp_skipped_datasets ts
                    WHERE ts.dataset_id = s.dataset_id AND ts.erddap_url = s.erddap_url);

  DELETE FROM cde.datasets d USING _prune_candidates c WHERE d.pk = c.pk;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;
