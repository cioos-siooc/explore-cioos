-- Add cde.trajectory_footprints: coverage-corridor polygons for Trajectory /
-- TrajectoryProfile datasets (one buffered corridor polygon per trajectory x
-- gap segment x ~30-day time slice). Mirrors the CREATE TABLE in 1_schema.sql;
-- see that file for column comments.
--
-- Function changes for corridor support (create_temp_trajectory_footprints,
-- trajectory_footprints_* helpers, create_temp_tables, remove_all_data,
-- process_incremental_update) are NOT duplicated here: db_migrate re-applies
-- the idempotent function files (3_*.sql .. 9_*.sql) after the migrations on
-- every deploy.
--
-- Apply to a LIVE database. Idempotent — safe to run repeatedly.

CREATE TABLE IF NOT EXISTS cde.trajectory_footprints (
    pk serial PRIMARY KEY,
    dataset_pk integer,
    erddap_url text,
    dataset_id text,
    trajectory_id text DEFAULT '',
    segment_id integer DEFAULT 0,
    time_min timestamptz,
    time_max timestamptz,
    depth_min double precision,
    depth_max double precision,
    geom geometry(MultiPolygon, 3857),
    FOREIGN KEY (dataset_pk) REFERENCES cde.datasets(pk)
);

CREATE INDEX IF NOT EXISTS trajectory_footprints_geom_gist ON cde.trajectory_footprints USING GIST (geom);
CREATE INDEX IF NOT EXISTS trajectory_footprints_dataset_idx ON cde.trajectory_footprints (erddap_url, dataset_id);
ALTER TABLE cde.trajectory_footprints SET (fillfactor = 90);
