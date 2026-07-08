-- Add cde.trajectory_points: ordered, downsampled track fixes for
-- Trajectory / TrajectoryProfile datasets (one row per trajectory x retained
-- fix), and cde.trajectory_track_stats: the per-trajectory summary rebuilt on
-- each load. Mirrors the CREATE TABLEs in 1_schema.sql; see that file for
-- column comments.
--
-- Function changes for track support (trajectory_points_link_dataset_pk,
-- trajectory_refresh_track_stats, trajectory_process, create_temp_tables,
-- replace_trajectory_points_from_temp, process_incremental_update,
-- remove_all_data) are NOT duplicated here: db_migrate re-applies the
-- idempotent function files (3_*.sql .. 9_*.sql) after the migrations.
--
-- Apply to a LIVE database. Idempotent — safe to run repeatedly.

CREATE TABLE IF NOT EXISTS cde.trajectory_points (
    pk serial PRIMARY KEY,
    dataset_pk integer,
    erddap_url text,
    dataset_id text,
    trajectory_id text DEFAULT '',
    profile_id text,
    time timestamptz NOT NULL,
    latitude double precision,
    longitude double precision,
    geom geometry(Point, 3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)) STORED,
    UNIQUE (erddap_url, dataset_id, trajectory_id, time),
    FOREIGN KEY (dataset_pk) REFERENCES cde.datasets(pk)
);

CREATE INDEX IF NOT EXISTS trajectory_points_time_idx ON cde.trajectory_points (time);
CREATE INDEX IF NOT EXISTS trajectory_points_traj_time_idx ON cde.trajectory_points (dataset_pk, trajectory_id, time);
CREATE INDEX IF NOT EXISTS trajectory_points_geom_gist ON cde.trajectory_points USING GIST (geom);
ALTER TABLE cde.trajectory_points SET (fillfactor = 90);

CREATE TABLE IF NOT EXISTS cde.trajectory_track_stats (
    dataset_pk integer,
    trajectory_id text DEFAULT '',
    time_min timestamptz,
    time_max timestamptz,
    n_points bigint,
    bbox geometry(Geometry, 3857),
    PRIMARY KEY (dataset_pk, trajectory_id)
);
CREATE INDEX IF NOT EXISTS trajectory_track_stats_bbox_gist ON cde.trajectory_track_stats USING GIST (bbox);
