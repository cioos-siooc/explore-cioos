-- Relax the shared-table constraints so incremental loads no longer need
-- per-run ALTER TABLE DDL.
--
-- Background: incremental harvests insert profiles with NULL point_pk/hex_*_pk
-- and backfill them afterwards, and create_hexes() wipes+rebuilds the
-- hexes_zoom_* tables. To allow that, process_incremental_update() used to call
-- drop_constraints()/set_constraints(), which ALTER the shared cde.datasets/
-- profiles/points tables. ALTER TABLE needs an ACCESS EXCLUSIVE lock, which
-- conflicts with the ACCESS SHARE locks every live web-api SELECT holds, and the
-- two deadlock (the DDL grabs datasets-exclusive, a reader mid-join holds
-- profiles-share and then wants datasets-share). The advisory lock in the
-- db-loader only serializes loaders against each other, so it cannot prevent it.
--
-- Fix: make the constraint state permanent and reader-compatible so the
-- incremental path is pure DML (ROW EXCLUSIVE, which coexists with readers):
--   * the backfilled columns stay NULL-able (enforced instead by
--     validate_loaded_data(), a plain SELECT — see 7_contraints.sql);
--   * the hex FKs become DEFERRABLE INITIALLY DEFERRED so create_hexes() can
--     rebuild+relink within the transaction and the FK is checked once at COMMIT.
--
-- Idempotent and guarded: each step is skipped once already applied, so re-running
-- on every deploy (db_migrate) does no work and takes no ACCESS EXCLUSIVE lock.
-- The very first application runs during db_migrate, before web-api starts.

-- 1. Drop the NOT NULL constraints that set_constraints() used to toggle.
DO $$
DECLARE
  col text;
  profile_cols text[] := ARRAY[
    'geom','dataset_pk','erddap_url','dataset_id','time_min','time_max',
    'latitude','longitude','depth_min','depth_max','n_records','point_pk',
    'records_per_day'];
  dataset_cols text[] := ARRAY[
    'dataset_id','erddap_url','cdm_data_type','title','organizations','eovs',
    'n_profiles','platform','organization_pks'];
BEGIN
  FOREACH col IN ARRAY profile_cols LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'cde.profiles'::regclass AND attname = col AND attnotnull
    ) THEN
      EXECUTE format('ALTER TABLE cde.profiles ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;

  FOREACH col IN ARRAY dataset_cols LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'cde.datasets'::regclass AND attname = col AND attnotnull
    ) THEN
      EXECUTE format('ALTER TABLE cde.datasets ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;
END $$;

-- 2. Convert the hex FKs to DEFERRABLE INITIALLY DEFERRED. Only rebuilds a
-- constraint that isn't already deferrable, so the FK-validating table scan runs
-- at most once (not on every deploy).
DO $$
DECLARE
  fk record;
  fks text[][] := ARRAY[
    -- [table, constraint_name, fk_column, referenced_table]
    ['profiles', 'hexes_zoom_0_foreign',        'hex_0_pk', 'hexes_zoom_0'],
    ['profiles', 'hexes_zoom_1_foreign',        'hex_1_pk', 'hexes_zoom_1'],
    ['points',   'hexes_zoom_0_points_foreign', 'hex_0_pk', 'hexes_zoom_0'],
    ['points',   'hexes_zoom_1_points_foreign', 'hex_1_pk', 'hexes_zoom_1']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(fks, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = fks[i][2]
        AND conrelid = ('cde.' || fks[i][1])::regclass
        AND condeferrable
    ) THEN
      EXECUTE format('ALTER TABLE cde.%I DROP CONSTRAINT IF EXISTS %I',
                     fks[i][1], fks[i][2]);
      EXECUTE format(
        'ALTER TABLE cde.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
        'REFERENCES cde.%I (pk) DEFERRABLE INITIALLY DEFERRED',
        fks[i][1], fks[i][2], fks[i][3], fks[i][4]);
    END IF;
  END LOOP;
END $$;
