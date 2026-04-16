/*

Incremental mode UPSERT functions

These functions handle the UPSERT operations when running in incremental mode.
They merge data from temporary tables into the main tables.

Functions:
- create_temp_tables() - Create temporary staging tables
- upsert_datasets_from_temp() - UPSERT datasets from temp_datasets
- replace_profiles_from_temp() - Replace profiles for updated datasets
- replace_obis_cells_from_temp() - Replace obis_cells for updated datasets
- upsert_skipped_datasets_from_temp() - UPSERT skipped datasets
- process_incremental_update() - Main orchestrator for entire incremental workflow

*/


-- Create temporary tables for incremental mode
-- These mirror the structure of main tables but without constraints
CREATE OR REPLACE FUNCTION create_temp_tables() RETURNS VOID AS $$
BEGIN
  -- Create temp tables with same structure as main tables
  CREATE TEMP TABLE IF NOT EXISTS temp_datasets (LIKE cde.datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  CREATE TEMP TABLE IF NOT EXISTS temp_profiles (LIKE cde.profiles INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  CREATE TEMP TABLE IF NOT EXISTS temp_skipped_datasets (LIKE cde.skipped_datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
  CREATE TEMP TABLE IF NOT EXISTS temp_obis_cells (LIKE cde.obis_cells INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);

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
    ALTER COLUMN hex_zoom_0 DROP NOT NULL,
    ALTER COLUMN hex_zoom_1 DROP NOT NULL,
    ALTER COLUMN point_pk DROP NOT NULL,
    ALTER COLUMN records_per_day DROP NOT NULL;
END;
$$ LANGUAGE plpgsql;


-- UPSERT datasets from temp table into main datasets table
-- Uses (dataset_id, erddap_url) as unique key
CREATE OR REPLACE FUNCTION upsert_datasets_from_temp() RETURNS VOID AS $$
BEGIN
  INSERT INTO cde.datasets
  SELECT * FROM temp_datasets
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
    source_type = EXCLUDED.source_type;
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

  -- Insert new profiles from temp table
  INSERT INTO cde.profiles
  SELECT * FROM temp_profiles;
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

  -- Insert new obis_cells from temp table
  INSERT INTO cde.obis_cells (dataset_id, latitude, longitude, scientific_names, n_records, time_min, time_max, depth_min, depth_max)
  SELECT dataset_id, latitude, longitude, scientific_names, n_records, time_min, time_max, depth_min, depth_max
  FROM temp_obis_cells
  ON CONFLICT (dataset_id, latitude, longitude) DO UPDATE SET
    scientific_names = EXCLUDED.scientific_names,
    n_records = EXCLUDED.n_records,
    time_min = EXCLUDED.time_min,
    time_max = EXCLUDED.time_max,
    depth_min = EXCLUDED.depth_min,
    depth_max = EXCLUDED.depth_max;
END;
$$ LANGUAGE plpgsql;


-- Main incremental processing function
-- Orchestrates the entire incremental update workflow
CREATE OR REPLACE FUNCTION process_incremental_update() RETURNS VOID AS $$
BEGIN
  -- 1. Process temp tables to populate computed fields
  PERFORM process_temp_profiles();

  -- 2. UPSERT datasets
  PERFORM upsert_datasets_from_temp();

  -- 3. Temporarily drop constraints to allow NULL hex values
  PERFORM drop_constraints();

  -- 4. Replace profiles (delete old, insert new)
  PERFORM replace_profiles_from_temp();

  -- 5. Replace obis_cells (delete old, insert new)
  PERFORM replace_obis_cells_from_temp();

  -- 6. UPSERT skipped datasets
  PERFORM upsert_skipped_datasets_from_temp();

  -- 7. Run processing functions to populate remaining fields
  -- Note: profile_process() rebuilds points from profiles; obis_process() must run after
  PERFORM ckan_process();
  PERFORM profile_process();
  PERFORM obis_process();

  -- 8. Create hexes for all data
  PERFORM create_hexes();

  -- 9. Restore constraints
  PERFORM set_constraints();
END;
$$ LANGUAGE plpgsql;
