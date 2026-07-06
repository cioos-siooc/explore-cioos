-- Add per-feature bounding box + display flag to cde.profiles.
--
-- The harvester now derives each profile/timeseries feature's location from its
-- lat/lon min/max (bounding box) instead of a single first GPS fix:
--   latitude_min/max, longitude_min/max - the feature's bounding box.
--   bbox                                 - GENERATED indexed geometry spatial
--                                          search matches against, so a feature
--                                          is found across its whole extent (not
--                                          just its display point). ST_MakeEnvelope
--                                          yields a Point when min==max, hence
--                                          geometry(Geometry,...) not Polygon.
--   show_as_point                        - false when the box diagonal > ~1km:
--                                          still searchable + counted in the
--                                          zoomed-out hexes, but not drawn as an
--                                          individual dot at point zoom.
-- The existing latitude/longitude columns keep the representative display point
-- (exact location, or the box midpoint).
--
-- Apply to a LIVE database (where re-running 1_schema.sql would DROP the table).
-- Idempotent — safe to run repeatedly. Columns are appended at table end so the
-- incremental path's temp_profiles (LIKE cde.profiles) stays column-aligned.
--
--   docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
--     < database/migrations/add-profiles-bbox-columns.sql

ALTER TABLE cde.profiles
  ADD COLUMN IF NOT EXISTS latitude_min double precision,
  ADD COLUMN IF NOT EXISTS latitude_max double precision,
  ADD COLUMN IF NOT EXISTS longitude_min double precision,
  ADD COLUMN IF NOT EXISTS longitude_max double precision,
  ADD COLUMN IF NOT EXISTS show_as_point boolean NOT NULL DEFAULT true;

ALTER TABLE cde.profiles
  ADD COLUMN IF NOT EXISTS bbox geometry(Geometry,3857) GENERATED ALWAYS AS
    (ST_Transform(ST_SetSRID(
      ST_MakeEnvelope(longitude_min, latitude_min, longitude_max, latitude_max),
      4326), 3857)) STORED;

CREATE INDEX IF NOT EXISTS profiles_bbox_gist ON cde.profiles USING GIST (bbox);
