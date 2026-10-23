-- Rewrite cde.datasets.coverage_bbox on databases created before single-point
-- grids were stored as a Point instead of a zero-area polygon.
--
-- 1_schema.sql only runs on a fresh volume; db_migrate applies [3-9]_*.sql on
-- every deploy. The expression must match 1_schema.sql. Guarded so the table
-- is rewritten once, not on every deploy; no re-harvest needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'cde.datasets'::regclass
      AND a.attname = 'coverage_bbox'
      AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%st_envelope%'
  ) THEN
    ALTER TABLE cde.datasets ALTER COLUMN coverage_bbox SET EXPRESSION AS (
      CASE
        WHEN coverage_lon_min IS NULL OR coverage_lon_max IS NULL
          OR coverage_lat_min IS NULL OR coverage_lat_max IS NULL THEN NULL
        WHEN coverage_lon_min <= coverage_lon_max THEN
          ST_Transform(ST_SetSRID(ST_Envelope(ST_MakeEnvelope(
            coverage_lon_min, LEAST(GREATEST(coverage_lat_min, -85.06), 85.06),
            coverage_lon_max, LEAST(GREATEST(coverage_lat_max, -85.06), 85.06))),
            4326), 3857)
        ELSE
          ST_Transform(ST_SetSRID(ST_Collect(
            ST_MakeEnvelope(
              coverage_lon_min, LEAST(GREATEST(coverage_lat_min, -85.06), 85.06),
              180,              LEAST(GREATEST(coverage_lat_max, -85.06), 85.06)),
            ST_MakeEnvelope(
              -180,             LEAST(GREATEST(coverage_lat_min, -85.06), 85.06),
              coverage_lon_max, LEAST(GREATEST(coverage_lat_max, -85.06), 85.06))),
            4326), 3857)
      END);
  END IF;
END
$$;
