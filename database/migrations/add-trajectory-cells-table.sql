-- Add cde.trajectory_cells: coverage cells for Trajectory / TrajectoryProfile
-- datasets (one row per trajectory x 1/12-degree grid cell). Mirrors the
-- CREATE TABLE in 1_schema.sql; see that file for column comments.
--
-- Function changes for trajectory support (create_hexes, remove_all_data,
-- trajectory_* helpers, process_incremental_update, create_temp_tables) are
-- NOT duplicated here: db_migrate re-applies the idempotent function files
-- (3_*.sql .. 9_*.sql) after the migrations on every deploy.
--
-- Apply to a LIVE database. Idempotent — safe to run repeatedly.

CREATE TABLE IF NOT EXISTS cde.trajectory_cells (
    pk serial PRIMARY KEY,
    dataset_pk integer,
    erddap_url text,
    dataset_id text,
    trajectory_id text DEFAULT '',
    latitude double precision,
    longitude double precision,
    geom geometry(Point, 3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)) STORED,
    time_min timestamptz,
    time_max timestamptz,
    depth_min double precision,
    depth_max double precision,
    n_records bigint,
    n_profiles bigint DEFAULT 0,
    records_per_day float,
    days bigint,
    hex_0_pk integer,
    hex_1_pk integer,
    point_pk integer,
    UNIQUE(erddap_url, dataset_id, trajectory_id, latitude, longitude),
    FOREIGN KEY (dataset_pk) REFERENCES cde.datasets(pk)
);

CREATE INDEX IF NOT EXISTS trajectory_cells_geom_gist ON cde.trajectory_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS trajectory_cells_latlon_idx ON cde.trajectory_cells (latitude, longitude);
CREATE INDEX IF NOT EXISTS trajectory_cells_hex_0_idx ON cde.trajectory_cells (hex_0_pk);
CREATE INDEX IF NOT EXISTS trajectory_cells_hex_1_idx ON cde.trajectory_cells (hex_1_pk);
ALTER TABLE cde.trajectory_cells SET (fillfactor = 80);

-- Cleanup for databases that applied an earlier revision of this branch:
-- (erddap_url, dataset_id) is a prefix of the UNIQUE constraint's index, so
-- the standalone index was redundant; trajectory_link_point_pk() was folded
-- into create_hexes() (point_pk + hex FKs linked in one UPDATE).
DROP INDEX IF EXISTS cde.trajectory_cells_dataset_idx;
DROP FUNCTION IF EXISTS trajectory_link_point_pk();
