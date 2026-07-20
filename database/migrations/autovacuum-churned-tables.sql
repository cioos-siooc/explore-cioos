-- Aggressive autovacuum on the tables incremental loads churn
-- (DELETE+INSERT per changed dataset). At the default scale factor (0.2) a
-- 780k-row table accrues ~156k dead tuples before autovacuum reacts, which
-- then bursts IO against live web-api traffic; 0.02 makes cleanup small and
-- frequent instead, with autovacuum's cost-based throttling pacing the IO.
-- Mirrors the defaults in 1_schema.sql.
--
-- Idempotent and guarded: ALTER TABLE ... SET (storage params) takes a
-- SHARE UPDATE EXCLUSIVE lock (readers unaffected, but no reason to take it
-- on every deploy), so each table is skipped once its reloptions already
-- carry the value.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['profiles', 'obis_cells', 'trajectory_cells', 'points'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = ('cde.' || tbl)::regclass
        AND reloptions @> ARRAY['autovacuum_vacuum_scale_factor=0.02']
    ) THEN
      EXECUTE format(
        'ALTER TABLE cde.%I SET (autovacuum_vacuum_scale_factor = 0.02, '
        'autovacuum_analyze_scale_factor = 0.02)', tbl);
      RAISE NOTICE 'autovacuum-churned-tables: tuned cde.%', tbl;
    END IF;
  END LOOP;
END $$;
