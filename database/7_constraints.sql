/*

 validate_loaded_data()
 set_constraints()   -- backwards-compat shim
 drop_constraints()  -- backwards-compat shim

 Loads must never ALTER TABLE: its ACCESS EXCLUSIVE lock deadlocks with live
 web-api readers. So backfilled columns stay NULL-able and are checked by
 validate_loaded_data() (a plain SELECT), and the hex FKs are DEFERRABLE
 INITIALLY DEFERRED (see 1_schema.sql), checked once at COMMIT.

 */


-- Raise (aborting the load transaction) if any column that must be populated by
-- the end of a load is still NULL.
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


-- Backwards-compat shim for older callers.
CREATE OR REPLACE FUNCTION set_constraints() RETURNS VOID AS $$
BEGIN
  PERFORM validate_loaded_data();
END;
$$ LANGUAGE plpgsql;


-- Backwards-compat no-op for older callers.
CREATE OR REPLACE FUNCTION drop_constraints() RETURNS VOID AS $$
BEGIN
  -- intentionally empty
END;
$$ LANGUAGE plpgsql;
