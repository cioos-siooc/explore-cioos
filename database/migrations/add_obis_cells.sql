-- Migration: Add obis_cells table and remove OBIS-specific column from profiles

SET search_path TO cde, public;

-- Drop old scientific_names column from profiles (OBIS-only column)
ALTER TABLE cde.profiles DROP COLUMN IF EXISTS scientific_names;

-- Create obis_cells table
CREATE TABLE IF NOT EXISTS cde.obis_cells (
    pk serial PRIMARY KEY,
    geom geometry(Point, 3857),
    dataset_pk integer,
    dataset_id text,
    latitude double precision,
    longitude double precision,
    scientific_names text[] DEFAULT '{}',
    n_records bigint,
    time_min timestamptz,
    time_max timestamptz,
    depth_min double precision,
    depth_max double precision,
    hex_zoom_0 geometry(polygon, 3857),
    hex_zoom_1 geometry(polygon, 3857),
    hex_0_pk integer,
    hex_1_pk integer,
    point_pk integer,
    UNIQUE(dataset_id, latitude, longitude)
);

CREATE INDEX IF NOT EXISTS obis_cells_geom_idx ON cde.obis_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS obis_cells_hex_zoom_0_idx ON cde.obis_cells USING GIST (hex_zoom_0);
CREATE INDEX IF NOT EXISTS obis_cells_hex_zoom_1_idx ON cde.obis_cells USING GIST (hex_zoom_1);
CREATE INDEX IF NOT EXISTS obis_cells_dataset_id_idx ON cde.obis_cells (dataset_id);

-- Update remove_all_data to include obis_cells cleanup
CREATE OR REPLACE FUNCTION public.remove_all_data() RETURNS VOID AS $$
BEGIN
DELETE FROM cde.profiles;
DELETE FROM cde.obis_cells;
DELETE FROM cde.datasets;
DELETE FROM cde.organizations;
DELETE FROM cde.points;
DELETE FROM cde.skipped_datasets;
DELETE FROM cde.hexes_zoom_0;
DELETE FROM cde.hexes_zoom_1;
END;
$$ LANGUAGE plpgsql;
