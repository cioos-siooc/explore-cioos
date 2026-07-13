-- Add griddap (gridded dataset) metadata columns to cde.datasets.
--
-- Griddap datasets are harvested metadata-only: they have no rows in
-- profiles/trajectory_cells/obis_cells, so their spatial/temporal coverage
-- lives on the dataset row itself:
--   coverage_lat/lon_min/max - the grid's extent. Longitudes are normalized to
--                              [-180,180] by the harvester; lon_min > lon_max
--                              marks an antimeridian-crossing grid.
--   coverage_time_min/max    - time coverage (NULL for static grids).
--   coverage_depth_min/max   - vertical coverage (NULL when no depth axis).
--   grid_variables           - [{name, standard_name, long_name, units}]
--   grid_dimensions          - [{name, n_values, min, max, spacing,
--                                even_spacing, units}] in dataset order.
--   wms_url                  - ERDDAP WMS request URL, NULL when WMS disabled.
--   coverage_bbox            - GENERATED geometry the shared spatial filters
--                              match against (aliased to search_geom in the
--                              griddap query branches). Named coverage_* (not
--                              time_min etc.) because dbFilter.js emits
--                              unqualified column predicates that would become
--                              ambiguous against the combined-CTE joins.
--
-- Latitudes are clamped to +-85.06 inside the generated expression only (3857
-- blows up at the poles; raw values are preserved for display). A grid lying
-- entirely above 85N degenerates to a line at 85.06 - acceptable for search.
-- Antimeridian-crossing extents are split into two envelopes collected into a
-- MultiPolygon so ST_Intersects matches on both sides of 180.
--
-- Apply to a LIVE database (where re-running 1_schema.sql would DROP the table).
-- Idempotent — safe to run repeatedly. Columns are appended at table end so the
-- incremental path's temp_datasets (LIKE cde.datasets) stays column-aligned.
--
--   docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
--     < database/migrations/add-griddap-dataset-columns.sql

ALTER TABLE cde.datasets
  ADD COLUMN IF NOT EXISTS coverage_lat_min double precision,
  ADD COLUMN IF NOT EXISTS coverage_lat_max double precision,
  ADD COLUMN IF NOT EXISTS coverage_lon_min double precision,
  ADD COLUMN IF NOT EXISTS coverage_lon_max double precision,
  ADD COLUMN IF NOT EXISTS coverage_time_min timestamptz,
  ADD COLUMN IF NOT EXISTS coverage_time_max timestamptz,
  ADD COLUMN IF NOT EXISTS coverage_depth_min double precision,
  ADD COLUMN IF NOT EXISTS coverage_depth_max double precision,
  ADD COLUMN IF NOT EXISTS grid_variables jsonb,
  ADD COLUMN IF NOT EXISTS grid_dimensions jsonb,
  ADD COLUMN IF NOT EXISTS wms_url text;

ALTER TABLE cde.datasets
  ADD COLUMN IF NOT EXISTS coverage_bbox geometry(Geometry,3857) GENERATED ALWAYS AS (
    CASE
      WHEN coverage_lon_min IS NULL OR coverage_lon_max IS NULL
        OR coverage_lat_min IS NULL OR coverage_lat_max IS NULL THEN NULL
      WHEN coverage_lon_min <= coverage_lon_max THEN
        ST_Transform(ST_SetSRID(ST_MakeEnvelope(
          coverage_lon_min, LEAST(GREATEST(coverage_lat_min, -85.06), 85.06),
          coverage_lon_max, LEAST(GREATEST(coverage_lat_max, -85.06), 85.06)),
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
    END) STORED;

CREATE INDEX IF NOT EXISTS datasets_coverage_bbox_gist
  ON cde.datasets USING GIST (coverage_bbox) WHERE coverage_bbox IS NOT NULL;
