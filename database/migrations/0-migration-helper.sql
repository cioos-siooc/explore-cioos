-- Migration helper: bring a LIVE database's columns up to date with
-- 1_schema.sql, adding only what is actually missing.
--
-- WHY THIS EXISTS: Postgres runs database/1_schema.sql exactly once, on a fresh
-- volume (docker-entrypoint-initdb.d), and db_migrate never re-applies it (it
-- DROPs tables). So a column added to 1_schema.sql only ever reaches NEW
-- databases — every existing one silently lacks it until someone remembers to
-- hand-write a migration. When that step is missed the failure surfaces far
-- from its cause: datasets.source_type / .obis_nodes went missing exactly this
-- way, which made /obisNodes and /erddapServers return 500 and left the
-- frontend showing "the data service is not responding" with no filters and no
-- dataset list. This file would have closed that gap on the next deploy without
-- anyone writing a migration at all.
--
-- HOW IT WORKS: _expected_columns below is the inventory of every column
-- 1_schema.sql defines. The DO block compares it against pg_attribute and runs
-- one ALTER TABLE ... ADD COLUMN per column that is genuinely absent, naming
-- each one it adds. If the schema already matches, IT RUNS NO DDL AT ALL — just
-- a catalog read, no ALTER, no ACCESS EXCLUSIVE lock, one notice saying so.
-- That is what makes it safe on every deploy.
--
-- MAINTENANCE: add a column to 1_schema.sql -> add one line to the inventory
-- below. That is the entire upgrade path for existing databases; no new
-- migration file is needed unless the column also needs a data backfill.
--
-- FILENAME / ORDERING: db_migrate applies migrations/*.sql in glob
-- (alphabetical) order, then re-applies database/[3-9]_*.sql. The '0-' prefix
-- makes this run FIRST, before every other migration, because several of them
-- assume the columns exist: append-only-points.sql UPDATEs point_pk on
-- profiles / obis_cells / trajectory_cells, relax-shared-table-constraints.sql
-- ALTERs specific columns, stable-hex-grid.sql needs the hex tables' shape.
-- Running first is safe: no add-*.sql migration has a backfill that is skipped
-- when its column already exists, and a table that does not exist yet is
-- reported and left to the migration that creates it.
--
-- DELIBERATELY NOT HANDLED (this runs on every deploy — it stays boring):
--   * Missing TABLES. Absent tables are listed in a notice and skipped;
--     creating them belongs to a dedicated migration (add-obis-cells-table.sql,
--     add-trajectory-cells-table.sql, add-harvest-attempts-and-runs-tables.sql).
--   * GENERATED columns (datasets.coverage_bbox, profiles.bbox, the
--     obis_cells / trajectory_cells geom, download_jobs.time_total). Adding one
--     rewrites the entire table, which a blanket every-deploy file should never
--     start doing on its own; each has its own migration.
--   * Constraints, indexes, defaults or types on columns that already exist,
--     and column drops. Only "column is absent -> create it".
--   * Serial primary keys — a table missing its pk is broken beyond a column fix.
--
-- Columns that 1_schema.sql declares bare NOT NULL (harvest_runs.started_at /
-- .status, most of harvest_attempts) are listed NULLABLE here: ADD COLUMN NOT
-- NULL without a default fails outright on a table that already has rows.
-- NOT NULL *with* a DEFAULT is kept as declared — that one works, and Postgres
-- 11+ fills existing rows from a non-volatile default without a rewrite.
--
-- Apply to a LIVE database. Idempotent — safe to run repeatedly.

BEGIN;

CREATE TEMP TABLE _expected_columns (tbl text, col text, def text) ON COMMIT DROP;

INSERT INTO _expected_columns (tbl, col, def) VALUES
  -- hexes_zoom_0 / _1: (i, j) is the natural key. stable-hex-grid.sql runs
  -- after this file and backfills every row where i IS NULL, so adding the
  -- columns empty here loses nothing.
  ('hexes_zoom_0', 'i',    'integer'),
  ('hexes_zoom_0', 'j',    'integer'),
  ('hexes_zoom_0', 'geom', 'geometry(Polygon,3857)'),
  ('hexes_zoom_1', 'i',    'integer'),
  ('hexes_zoom_1', 'j',    'integer'),
  ('hexes_zoom_1', 'geom', 'geometry(Polygon,3857)'),

  -- datasets. source_type / obis_nodes are the pair whose absence caused the
  -- outage described above: both /obisNodes and /erddapServers filter on
  -- source_type, and the OBIS nodes map filter matches on obis_nodes
  -- (web-api/utils/dbFilter.js).
  ('datasets', 'pk_url',                 'integer'),
  ('datasets', 'dataset_id',             'text'),
  ('datasets', 'erddap_url',             'text'),
  ('datasets', 'platform',               'text'),
  ('datasets', 'title',                  'text'),
  ('datasets', 'title_fr',               'text'),
  ('datasets', 'summary',                'text'),
  ('datasets', 'summary_fr',             'text'),
  ('datasets', 'cdm_data_type',          'text'),
  ('datasets', 'organizations',          'text[]'),
  ('datasets', 'eovs',                   'text[]'),
  ('datasets', 'ckan_id',                'text'),
  ('datasets', 'timeseries_id_variable', 'text'),
  ('datasets', 'profile_id_variable',    'text'),
  ('datasets', 'trajectory_id_variable', 'text'),
  ('datasets', 'organization_pks',       'integer[]'),
  ('datasets', 'n_profiles',             'integer'),
  ('datasets', 'profile_variables',      'text[]'),
  ('datasets', 'num_columns',            'integer'),
  ('datasets', 'first_eov_column',       'text'),
  ('datasets', 'source_type',            'text DEFAULT ''erddap'''),
  ('datasets', 'obis_nodes',             'text[] DEFAULT ''{}'''),
  ('datasets', 'content_hash',           'text'),
  ('datasets', 'content_hash_reason',    'text'),
  ('datasets', 'last_updated_at',        'timestamptz'),
  ('datasets', 'verified_at',            'timestamptz'),
  ('datasets', 'coverage_lat_min',       'double precision'),
  ('datasets', 'coverage_lat_max',       'double precision'),
  ('datasets', 'coverage_lon_min',       'double precision'),
  ('datasets', 'coverage_lon_max',       'double precision'),
  ('datasets', 'coverage_time_min',      'timestamptz'),
  ('datasets', 'coverage_time_max',      'timestamptz'),
  ('datasets', 'coverage_depth_min',     'double precision'),
  ('datasets', 'coverage_depth_max',     'double precision'),
  ('datasets', 'grid_variables',         'jsonb'),
  ('datasets', 'grid_dimensions',        'jsonb'),
  ('datasets', 'wms_url',                'text'),

  -- organizations (name is UNIQUE in 1_schema.sql; only the column is added).
  ('organizations', 'pk_url', 'integer'),
  ('organizations', 'name',   'text'),
  ('organizations', 'color',  'text'),

  -- points (the hex FKs are not added here, only the columns;
  -- relax-shared-table-constraints.sql owns that constraint shape).
  ('points', 'geom',     'geometry(Point,3857)'),
  ('points', 'hex_0_pk', 'integer'),
  ('points', 'hex_1_pk', 'integer'),

  ('profiles', 'geom',          'geometry(Point,3857)'),
  ('profiles', 'dataset_pk',    'integer'),
  ('profiles', 'erddap_url',    'text'),
  ('profiles', 'dataset_id',    'text'),
  ('profiles', 'timeseries_id', 'text'),
  ('profiles', 'profile_id',    'text'),
  ('profiles', 'time_min',      'timestamptz'),
  ('profiles', 'time_max',      'timestamptz'),
  ('profiles', 'latitude',      'double precision'),
  ('profiles', 'longitude',     'double precision'),
  ('profiles', 'latitude_min',  'double precision'),
  ('profiles', 'latitude_max',  'double precision'),
  ('profiles', 'longitude_min', 'double precision'),
  ('profiles', 'longitude_max', 'double precision'),
  ('profiles', 'show_as_point', 'boolean NOT NULL DEFAULT true'),
  ('profiles', 'depth_min',     'double precision'),
  ('profiles', 'depth_max',     'double precision'),
  ('profiles', 'n_records',     'bigint'),
  ('profiles', 'records_per_day', 'float'),
  ('profiles', 'n_profiles',    'bigint'),
  ('profiles', 'hex_0_pk',      'integer'),
  ('profiles', 'hex_1_pk',      'integer'),
  ('profiles', 'point_pk',      'integer'),
  ('profiles', 'days',          'bigint'),

  ('obis_cells', 'dataset_pk',       'integer'),
  ('obis_cells', 'dataset_id',       'text'),
  ('obis_cells', 'latitude',         'double precision'),
  ('obis_cells', 'longitude',        'double precision'),
  ('obis_cells', 'scientific_names', 'text[] DEFAULT ''{}'''),
  ('obis_cells', 'aphia_ids',        'integer[] NOT NULL DEFAULT ''{}'''),
  ('obis_cells', 'n_records',        'bigint'),
  ('obis_cells', 'time_min',         'timestamptz'),
  ('obis_cells', 'time_max',         'timestamptz'),
  ('obis_cells', 'depth_min',        'double precision'),
  ('obis_cells', 'depth_max',        'double precision'),
  ('obis_cells', 'hex_0_pk',         'integer'),
  ('obis_cells', 'hex_1_pk',         'integer'),
  ('obis_cells', 'point_pk',         'integer'),

  ('trajectory_cells', 'dataset_pk',      'integer'),
  ('trajectory_cells', 'erddap_url',      'text'),
  ('trajectory_cells', 'dataset_id',      'text'),
  -- DEFAULT '' (empty string) — the quotes are doubled for the SQL literal.
  ('trajectory_cells', 'trajectory_id',   'text DEFAULT '''''),
  ('trajectory_cells', 'latitude',        'double precision'),
  ('trajectory_cells', 'longitude',       'double precision'),
  ('trajectory_cells', 'time_min',        'timestamptz'),
  ('trajectory_cells', 'time_max',        'timestamptz'),
  ('trajectory_cells', 'depth_min',       'double precision'),
  ('trajectory_cells', 'depth_max',       'double precision'),
  ('trajectory_cells', 'n_records',       'bigint'),
  ('trajectory_cells', 'n_profiles',      'bigint DEFAULT 0'),
  ('trajectory_cells', 'records_per_day', 'float'),
  ('trajectory_cells', 'days',            'bigint'),
  ('trajectory_cells', 'hex_0_pk',        'integer'),
  ('trajectory_cells', 'hex_1_pk',        'integer'),
  ('trajectory_cells', 'point_pk',        'integer'),

  ('scientific_name_vernaculars', 'aphia_id',           'integer'),
  ('scientific_name_vernaculars', 'rank',               'text'),
  ('scientific_name_vernaculars', 'ancestor_aphia_ids', 'integer[] NOT NULL DEFAULT ''{}'''),
  ('scientific_name_vernaculars', 'vernaculars_en',     'text[] NOT NULL DEFAULT ''{}'''),
  ('scientific_name_vernaculars', 'vernaculars_fr',     'text[] NOT NULL DEFAULT ''{}'''),
  ('scientific_name_vernaculars', 'fetched_at',         'timestamptz NOT NULL DEFAULT now()'),
  ('scientific_name_vernaculars', 'fetch_status',       'text NOT NULL DEFAULT ''ok'''),

  -- download_jobs.time_total is generated from (time_complete - time); see the
  -- header note on generated columns.
  ('download_jobs', 'time',              'timestamptz DEFAULT now()'),
  ('download_jobs', 'job_id',            'text'),
  ('download_jobs', 'email',             'text'),
  ('download_jobs', 'status',            'text DEFAULT ''open''::text'),
  ('download_jobs', 'download_size',     'numeric'),
  ('download_jobs', 'estimate_size',     'numeric'),
  ('download_jobs', 'estimate_details',  'text'),
  ('download_jobs', 'erddap_report',     'text'),
  ('download_jobs', 'time_start',        'timestamp with time zone'),
  ('download_jobs', 'time_complete',     'timestamp with time zone'),
  ('download_jobs', 'downloader_input',  'text'),
  ('download_jobs', 'downloader_output', 'text'),

  ('skipped_datasets', 'erddap_url',  'text'),
  ('skipped_datasets', 'dataset_id',  'text'),
  ('skipped_datasets', 'reason_code', 'text'),

  ('organizations_lookup', 'name', 'text'),

  ('datasets_lookup', 'dataset_id', 'text'),
  ('datasets_lookup', 'erddap_url', 'text'),

  -- harvest_runs / harvest_attempts: NOT NULL relaxed here, see header.
  ('harvest_runs', 'started_at',          'timestamptz'),
  ('harvest_runs', 'finished_at',         'timestamptz'),
  ('harvest_runs', 'git_sha',             'text'),
  ('harvest_runs', 'status',              'text'),
  ('harvest_runs', 'error_message',       'text'),
  ('harvest_runs', 'prefect_flow_run_id', 'text'),
  ('harvest_runs', 'scope',               'text'),
  ('harvest_runs', 'triggered_source',    'text'),
  ('harvest_runs', 'triggered_by',        'text'),

  ('harvest_attempts', 'erddap_url',    'text'),
  ('harvest_attempts', 'dataset_id',    'text'),
  ('harvest_attempts', 'source',        'text'),
  ('harvest_attempts', 'status',        'text'),
  ('harvest_attempts', 'reason_code',   'text'),
  ('harvest_attempts', 'error_message', 'text'),
  ('harvest_attempts', 'duration_ms',   'integer'),
  ('harvest_attempts', 'attempted_at',  'timestamptz'),
  ('harvest_attempts', 'query_urls',    'text'),
  ('harvest_attempts', 'warnings',      'text');

DO $$
DECLARE
  spec    record;
  added   integer := 0;
  absent  text[];
BEGIN
  -- Tables that don't exist yet: report them, then ignore their columns. A
  -- dedicated migration creates these, and it creates them complete.
  SELECT array_agg(DISTINCT tbl ORDER BY tbl) INTO absent
    FROM _expected_columns
   WHERE to_regclass('cde.' || tbl) IS NULL;

  IF absent IS NOT NULL THEN
    RAISE NOTICE
      'migration-helper: table(s) not present, their columns skipped (a dedicated migration creates them): %',
      array_to_string(absent, ', ');
  END IF;

  -- One ALTER per genuinely-missing column. Nothing missing => nothing runs.
  FOR spec IN
    SELECT e.tbl, e.col, e.def
      FROM _expected_columns e
     WHERE to_regclass('cde.' || e.tbl) IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = ('cde.' || e.tbl)::regclass
                AND a.attname  = e.col
                AND NOT a.attisdropped
           )
     ORDER BY e.tbl, e.col
  LOOP
    EXECUTE format('ALTER TABLE cde.%I ADD COLUMN %I %s', spec.tbl, spec.col, spec.def);
    RAISE NOTICE 'migration-helper: added cde.%.% (%)', spec.tbl, spec.col, spec.def;
    added := added + 1;
  END LOOP;

  IF added = 0 THEN
    RAISE NOTICE 'migration-helper: columns already match 1_schema.sql, no DDL run';
  ELSE
    RAISE NOTICE 'migration-helper: added % missing column(s)', added;
  END IF;
END $$;

COMMIT;
