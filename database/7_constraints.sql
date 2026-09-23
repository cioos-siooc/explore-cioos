/*

 validate_loaded_data()
 set_constraints()   -- backwards-compat shim
 drop_constraints()  -- backwards-compat shim

 The shared cde.datasets/profiles/points tables used to have their NOT NULL and
 hex-FK constraints toggled off before a load and back on after it, via ALTER
 TABLE (set_constraints/drop_constraints). ALTER TABLE needs an ACCESS EXCLUSIVE
 lock, which conflicts with the ACCESS SHARE locks live web-api SELECTs hold, so
 an incremental load running against a live portal deadlocked with readers.

 The constraints are now permanent and reader-compatible instead:
   * the backfilled columns stay NULL-able and their "must be filled by
     end-of-load" guarantee is enforced by validate_loaded_data() below — a plain
     SELECT (ACCESS SHARE), so it never blocks or deadlocks readers;
   * the hex FKs are DEFERRABLE INITIALLY DEFERRED (see 1_schema.sql), checked
     once at COMMIT.

 With no per-run ALTER TABLE, the whole load path is DML (ROW EXCLUSIVE) and runs
 concurrently with readers. set_constraints()/drop_constraints() are retained as
 no-op/validate shims so any older caller (e.g. a not-yet-redeployed db-loader)
 keeps working.

 */


-- Raise if any column that must be populated by the end of a load is still NULL,
-- aborting the transaction exactly as the old NOT NULL constraints would have.
CREATE OR REPLACE FUNCTION validate_loaded_data() RETURNS VOID AS $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
  FROM cde.datasets
  WHERE dataset_id IS NULL
     OR erddap_url IS NULL
     OR cdm_data_type IS NULL
     OR title IS NULL
     OR organizations IS NULL
     OR eovs IS NULL
     OR n_profiles IS NULL
     OR platform IS NULL
     OR organization_pks IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'validate_loaded_data: % row(s) in cde.datasets have NULL required columns', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM cde.profiles
  WHERE geom IS NULL
     OR dataset_pk IS NULL
     OR erddap_url IS NULL
     OR dataset_id IS NULL
     OR time_min IS NULL
     OR time_max IS NULL
     OR latitude IS NULL
     OR longitude IS NULL
     OR depth_min IS NULL
     OR depth_max IS NULL
     OR n_records IS NULL
     OR point_pk IS NULL
     OR records_per_day IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'validate_loaded_data: % row(s) in cde.profiles have NULL required columns', bad;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- Backwards-compat shim. The old set_constraints() re-added NOT NULL + hex FKs
-- via ALTER TABLE; that guarantee is now validate_loaded_data() (no ALTER TABLE).
CREATE OR REPLACE FUNCTION set_constraints() RETURNS VOID AS $$
BEGIN
  PERFORM validate_loaded_data();
END;
$$ LANGUAGE plpgsql;


-- Backwards-compat shim. Constraints are no longer toggled per-load (columns are
-- permanently NULL-able and the hex FKs are DEFERRABLE), so there is nothing to
-- drop; kept as a no-op for older callers.
CREATE OR REPLACE FUNCTION drop_constraints() RETURNS VOID AS $$
BEGIN
  -- intentionally empty
END;
$$ LANGUAGE plpgsql;
