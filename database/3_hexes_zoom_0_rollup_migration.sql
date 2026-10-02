-- Add cde.hexes_zoom_0_rollup to databases created before it existed.
--
-- 1_schema.sql only runs on a fresh volume; db_migrate applies [3-9]_*.sql on
-- every deploy, so this creates the table on live databases, and the backfill
-- at the end of 5_profile_process.sql fills it (sorted after this file). The
-- DDL must match 1_schema.sql. No-op on fresh volumes.
CREATE TABLE IF NOT EXISTS cde.hexes_zoom_0_rollup (
    hex_pk integer NOT NULL,
    dataset_pk integer NOT NULL,
    -- 'profiles' (show_as_point rows only), 'trajectory' or 'obis': the
    -- routes' source toggles gate on it.
    source text NOT NULL,
    n_records bigint NOT NULL,
    -- The source rows' day sets unioned into disjoint ranges, each row's
    -- [time_min, time_max] span standing in where its own set is unknown —
    -- the rule utils/hexMetric.js applies per row. NULL when no row has days.
    day_ranges daterange[],
    PRIMARY KEY (hex_pk, dataset_pk, source)
);
