/* 
    Create the tables
 
 */


-- We are using features from PostGIS 3
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE schema cde;

SET search_path TO cde, public;

-- (i, j) are the cell coordinates in PostGIS's origin-anchored hexagon grid
-- (ST_HexagonGrid/ST_Hexagon): geom is fully determined by (i, j) and the cell
-- size (100 km for zoom_0, 10 km for zoom_1). This natural key is what keeps
-- hex pks stable across loads — create_hexes() upserts on (i, j) and never
-- deletes, so a cell that already exists keeps its pk forever. Nullable (not
-- NOT NULL) so create_hexes() can insert a cell and set (i, j) within the same
-- load without a mid-transaction constraint failure.
DROP TABLE IF EXISTS hexes_zoom_0;
CREATE TABLE hexes_zoom_0 (
    pk serial PRIMARY KEY,
    i integer,
    j integer,
    geom geometry(Polygon,3857)
);

CREATE INDEX ON cde.hexes_zoom_0 USING GIST (geom);
CREATE UNIQUE INDEX hexes_zoom_0_ij_key ON cde.hexes_zoom_0 (i, j);

DROP TABLE IF EXISTS hexes_zoom_1;
CREATE TABLE hexes_zoom_1 (
    pk serial PRIMARY KEY,
    i integer,
    j integer,
    geom geometry(Polygon,3857)
  );

CREATE INDEX ON cde.hexes_zoom_1 USING GIST (geom);
CREATE UNIQUE INDEX hexes_zoom_1_ij_key ON cde.hexes_zoom_1 (i, j);

 

-- ERDDAP Datasets
DROP TABLE IF EXISTS datasets;
CREATE TABLE datasets (
    pk serial PRIMARY KEY,
    pk_url INTEGER,
    dataset_id TEXT,
    erddap_url TEXT,
    platform TEXT,
    title TEXT,
    title_fr TEXT,
    summary TEXT,
    summary_fr TEXT,
    cdm_data_type text,
    organizations text[],
    eovs text[],
    ckan_id text,
    timeseries_id_variable text,
    profile_id_variable text,
    trajectory_id_variable text,
    organization_pks INTEGER[],
    n_profiles integer,
    profile_variables text[],
    num_columns integer,
    first_eov_column TEXT,
    source_type TEXT DEFAULT 'erddap',
    obis_nodes text[] DEFAULT '{}',
    -- Croissant file-list hash (set only for file-backed datasets); skip-if-unchanged.
    content_hash TEXT,
    -- Why content_hash is NULL (HASH_* code: database-backed, Croissant fetch error, …);
    -- NULL when a hash was produced. Lets the dashboard explain unhashed datasets.
    content_hash_reason TEXT,
    last_updated_at timestamptz,
    verified_at timestamptz,
    -- Griddap (metadata-only) coverage. Kept at table end so temp_datasets
    -- (LIKE ...) column order stays stable.
    coverage_lat_min double precision,
    coverage_lat_max double precision,
    coverage_lon_min double precision,
    coverage_lon_max double precision,
    coverage_time_min timestamptz,
    coverage_time_max timestamptz,
    coverage_depth_min double precision,
    coverage_depth_max double precision,
    grid_variables jsonb,
    grid_dimensions jsonb,
    wms_url text,
    -- lat clamped to +-85.06 (3857 pole blowup); lon_min > lon_max means
    -- antimeridian-crossing -> split into a two-envelope MultiPolygon.
    coverage_bbox geometry(Geometry,3857) GENERATED ALWAYS AS (
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
      END) STORED,
    UNIQUE(dataset_id, erddap_url)
);

CREATE INDEX IF NOT EXISTS datasets_coverage_bbox_gist
  ON cde.datasets USING GIST (coverage_bbox) WHERE coverage_bbox IS NOT NULL;

-- List of organizations to show in CDE, from CKAN, can be many per dataset
DROP TABLE IF EXISTS organizations;
CREATE TABLE organizations (
    pk SERIAL PRIMARY KEY,
    pk_url INTEGER,
    name TEXT UNIQUE,
    color TEXT
);



-- One record per unique lat/long
-- this table is mostly used to build hexes, its not queried by the API
DROP TABLE IF EXISTS points;
CREATE TABLE points (
    pk serial PRIMARY KEY,
    geom geometry(Point,3857),
    -- FKs are DEFERRABLE INITIALLY DEFERRED: profiles are inserted with NULL
    -- hex pks and backfilled by create_hexes() within the load transaction, so
    -- the reference is only valid again at COMMIT (checked there, not
    -- per-statement). Deferring also keeps loads off ALTER TABLE / ACCESS
    -- EXCLUSIVE, which used to deadlock with live web-api reads.
    hex_0_pk integer CONSTRAINT hexes_zoom_0_points_foreign REFERENCES hexes_zoom_0(pk) DEFERRABLE INITIALLY DEFERRED,
    hex_1_pk integer CONSTRAINT hexes_zoom_1_points_foreign REFERENCES hexes_zoom_1(pk) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX ON points USING GIST (geom);
-- geom is the point's identity: the table is append-only (loads insert unseen
-- geometries with ON CONFLICT (geom) DO NOTHING, never delete or renumber),
-- which is what keeps point pks — and everything linked through them —
-- stable across loads. Orphans are GC'd by gc_orphan_points_and_hexes().
CREATE UNIQUE INDEX points_geom_key ON cde.points (geom);


-- profiles/timeseries per dataset
-- hex polygon geometries are stored on cde.hexes_zoom_0/1; only the FK is
-- carried here. Tile / legend queries JOIN to those tables when polygon geom
-- is needed.
DROP TABLE IF EXISTS profiles;
CREATE TABLE profiles (
    pk serial PRIMARY KEY,
    geom geometry(Point,3857),
    dataset_pk integer REFERENCES datasets(pk),
    erddap_url text,
    dataset_id text,
    timeseries_id text,
    profile_id text,
    time_min timestamptz,
    time_max timestamptz,
    -- Representative display point (exact location, or the bounding-box
    -- midpoint for features that span a region). geom (above) is the Point
    -- built from these for the point/hex map layers.
    latitude double precision,
    longitude double precision,
    -- Per-feature lat/lon bounding box. bbox is the indexed geometry spatial
    -- search matches against, so a feature is found across its whole extent
    -- (not just the single display point). ST_MakeEnvelope yields a Point when
    -- min==max, hence geometry(Geometry,...) rather than Polygon.
    latitude_min double precision,
    latitude_max double precision,
    longitude_min double precision,
    longitude_max double precision,
    bbox geometry(Geometry,3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(
        ST_MakeEnvelope(longitude_min, latitude_min, longitude_max, latitude_max),
        4326), 3857)) STORED,
    -- false = feature spans a region (box diagonal > ~1km): still searchable
    -- and counted in the zoomed-out hexes, but not drawn as an individual dot
    -- at point zoom. See web-api tiles/legend routes.
    show_as_point boolean NOT NULL DEFAULT true,
    depth_min double precision,
    depth_max double precision,
    n_records bigint,
    records_per_day float,
    n_profiles bigint,
    -- Hex FKs are DEFERRABLE INITIALLY DEFERRED for the same reason as on
    -- cde.points above: create_hexes() rebuilds+relinks within the transaction
    -- and the reference is validated at COMMIT, keeping loads off ACCESS
    -- EXCLUSIVE DDL that deadlocked with live reads.
    hex_0_pk integer CONSTRAINT hexes_zoom_0_foreign REFERENCES hexes_zoom_0(pk) DEFERRABLE INITIALLY DEFERRED,
    hex_1_pk integer CONSTRAINT hexes_zoom_1_foreign REFERENCES hexes_zoom_1(pk) DEFERRABLE INITIALLY DEFERRED,
    point_pk INTEGER,
    days bigint,
    UNIQUE(erddap_url,dataset_id,timeseries_id,profile_id)
);

CREATE INDEX ON profiles USING GIST (geom);
CREATE INDEX ON profiles USING GIST (bbox);
CREATE INDEX ON profiles(latitude);
CREATE INDEX ON profiles(longitude);
-- Index for efficient filtering by dataset during incremental updates
CREATE INDEX ON profiles(erddap_url, dataset_id);
-- Index for faster lookups when joining with specific profile/timeseries IDs
CREATE INDEX ON profiles(erddap_url, dataset_id, timeseries_id, profile_id);
-- Every tile/legend/shape query joins profiles.dataset_pk = datasets.pk; the
-- (erddap_url, dataset_id) index above does not serve a dataset_pk lookup, so
-- without this a single-dataset / Source-filter drilldown seq-scans profiles.
CREATE INDEX ON profiles(dataset_pk);




DROP TABLE IF EXISTS obis_cells;
CREATE TABLE obis_cells (
    pk serial PRIMARY KEY,
    -- geom is computed at INSERT time from latitude/longitude. Avoids the
    -- post-load full-table UPDATE that previously rewrote every row + every
    -- index entry. See obis_set_geom() in 5_profile_process.sql (now a no-op).
    dataset_pk integer,
    dataset_id text,
    latitude double precision,
    longitude double precision,
    geom geometry(Point, 3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)) STORED,
    scientific_names text[] DEFAULT '{}',
    -- WoRMS AphiaIDs corresponding to scientific_names. Populated post-harvest
    -- by joining each name to cde.scientific_name_vernaculars; see
    -- 5_profile_process.sql. Drives the rank-aware filter rolldown in
    -- web-api/utils/dbFilter.js — selecting a higher-rank name expands to a
    -- small integer set of descendant AphiaIDs and we test overlap on this
    -- column instead of building a 100k+ name array per tile request.
    aphia_ids integer[] NOT NULL DEFAULT '{}',
    n_records bigint,
    time_min timestamptz,
    time_max timestamptz,
    depth_min double precision,
    depth_max double precision,
    -- hex polygon geometries live on cde.hexes_zoom_0/1; only the FK is
    -- carried here. Tile / legend queries JOIN to get the polygon.
    hex_0_pk integer,
    hex_1_pk integer,
    point_pk integer,
    UNIQUE(dataset_id, latitude, longitude),
    FOREIGN KEY (dataset_pk) REFERENCES datasets(pk)
);

CREATE INDEX ON obis_cells USING GIST (geom);
CREATE INDEX ON obis_cells (dataset_id);
CREATE INDEX ON obis_cells (latitude, longitude);
-- Tile/legend/shape queries join obis_cells.dataset_pk = datasets.pk; (dataset_id)
-- above serves the incremental DELETE, not this integer-pk join.
CREATE INDEX ON obis_cells (dataset_pk);
-- /tiles/cells joins the visible hexes (tile_hexes) to cells on zoom_pk. Without
-- these, only trajectory_cells could index-prune and the OBIS half full-scanned
-- the whole table per coverage tile. Mirror trajectory_cells' hex indexes.
CREATE INDEX ON obis_cells (hex_0_pk);
CREATE INDEX ON obis_cells (hex_1_pk);
-- Partial GIN: only cells whose aphia_ids are still empty (i.e. WoRMS hasn't
-- resolved any of their scientific_names yet). The literal-name predicate in
-- web-api/utils/dbFilter.js fires only for those rows; once aphia_ids is
-- populated, the integer-set GIN below covers the filter and the text GIN
-- isn't needed. Saves substantial disk on resolved cells.
CREATE INDEX obis_cells_scientific_names_gin ON cde.obis_cells USING GIN (scientific_names)
  WHERE coalesce(array_length(aphia_ids, 1), 0) = 0;
CREATE INDEX obis_cells_aphia_ids_gin         ON cde.obis_cells USING GIN (aphia_ids);

-- FILLFACTOR leaves room on each page for HOT updates on non-indexed columns
-- (dataset_pk, point_pk, hex_*_pk are filled by post-load UPDATEs). Reduces
-- bloat from those passes; modest effect now that the geom UPDATE is gone.
ALTER TABLE cde.obis_cells SET (fillfactor = 80);
ALTER TABLE cde.points SET (fillfactor = 80);


-- Trajectory / TrajectoryProfile coverage cells: one row per (trajectory,
-- 1/12-degree grid cell) the track passes through, produced by the harvester's
-- trajectory dataset-type handler via server-side binned ERDDAP queries (no
-- full-resolution track is ever stored here). Modeled on obis_cells — same
-- generated geom, same points/hex FK propagation (see trajectory_* functions
-- in 5_profile_process.sql).
DROP TABLE IF EXISTS trajectory_cells;
CREATE TABLE trajectory_cells (
    pk serial PRIMARY KEY,
    dataset_pk integer,
    erddap_url text,
    dataset_id text,
    -- cf_role=trajectory_id value (mission/deployment); '' when the dataset
    -- has a single unnamed trajectory.
    trajectory_id text DEFAULT '',
    -- bin-center coordinates, rounded to 8 dp (same convention as obis_cells)
    latitude double precision,
    longitude double precision,
    geom geometry(Point, 3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)) STORED,
    time_min timestamptz,
    time_max timestamptz,
    depth_min double precision,
    depth_max double precision,
    n_records bigint,
    -- TrajectoryProfile: distinct profiles observed in this cell. 0 for plain
    -- Trajectory datasets.
    n_profiles bigint DEFAULT 0,
    -- computed at harvest time so the download-estimate math in
    -- web-api/utils/shapeQuery.js works unchanged on this table
    records_per_day float,
    days bigint,
    -- hex polygon geometries live on cde.hexes_zoom_0/1; only the FK is
    -- carried here (filled by create_hexes() via cde.points).
    hex_0_pk integer,
    hex_1_pk integer,
    point_pk integer,
    UNIQUE(erddap_url, dataset_id, trajectory_id, latitude, longitude),
    FOREIGN KEY (dataset_pk) REFERENCES datasets(pk)
);

CREATE INDEX trajectory_cells_geom_gist ON trajectory_cells USING GIST (geom);
-- No (erddap_url, dataset_id) index: the UNIQUE constraint's index above has
-- them as its leading columns and serves those lookups (incremental DELETE,
-- dataset_pk backfill join).
CREATE INDEX trajectory_cells_latlon_idx ON trajectory_cells (latitude, longitude);
-- Tile/legend/shape queries join trajectory_cells.dataset_pk = datasets.pk; the
-- UNIQUE(erddap_url, dataset_id, trajectory_id, ...) index cannot serve a bare
-- dataset_pk lookup, so add one.
CREATE INDEX trajectory_cells_dataset_pk_idx ON trajectory_cells (dataset_pk);
-- Drive the per-tile lookup in /tiles/trajectories: hexes intersecting the
-- tile envelope come from the hexes_zoom_* GIST, then these indexes fetch
-- just the cells under those hexes.
CREATE INDEX trajectory_cells_hex_0_idx ON trajectory_cells (hex_0_pk);
CREATE INDEX trajectory_cells_hex_1_idx ON trajectory_cells (hex_1_pk);
ALTER TABLE cde.trajectory_cells SET (fillfactor = 80);

-- Ordered, downsampled track fixes for Trajectory / TrajectoryProfile
-- datasets: one row per (trajectory, retained fix), produced by the
-- harvester's extract_track_points (per-profile fixes for TrajectoryProfile,
-- first-fix-per-day for plain Trajectory, capped per trajectory). Unlike
-- trajectory_cells these are RAW coordinates in time order — the source for
-- the /tiles/tracks line assembly and the /trajectories/track endpoint.
-- NOT hex-aggregated: no point_pk/hex FKs by design.
DROP TABLE IF EXISTS trajectory_points;
CREATE TABLE trajectory_points (
    pk serial PRIMARY KEY,
    dataset_pk integer,
    erddap_url text,
    dataset_id text,
    -- cf_role=trajectory_id value; '' when the dataset has a single unnamed
    -- trajectory (same convention as trajectory_cells).
    trajectory_id text DEFAULT '',
    -- cf_role=profile_id value for TrajectoryProfile fixes; NULL for plain
    -- Trajectory (per-day) fixes.
    profile_id text,
    time timestamptz NOT NULL,
    -- raw (unsnapped) fix coordinates
    latitude double precision,
    longitude double precision,
    geom geometry(Point, 3857) GENERATED ALWAYS AS
      (ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)) STORED,
    UNIQUE (erddap_url, dataset_id, trajectory_id, time),
    FOREIGN KEY (dataset_pk) REFERENCES datasets(pk)
);

-- (a) scrub-window queries: prune by time before per-trajectory assembly
CREATE INDEX trajectory_points_time_idx ON trajectory_points (time);
-- (b) ordered per-trajectory reads (ST_MakeLine ORDER BY time, full-track endpoint)
CREATE INDEX trajectory_points_traj_time_idx ON trajectory_points (dataset_pk, trajectory_id, time);
CREATE INDEX trajectory_points_geom_gist ON trajectory_points USING GIST (geom);
ALTER TABLE cde.trajectory_points SET (fillfactor = 90);

-- Per-trajectory summary, rebuilt on each load by trajectory_refresh_track_stats()
-- (5_profile_process.sql). Serves the /trajectories/platforms list and lets the
-- /tiles/tracks route prune candidate trajectories by bbox before assembling
-- lines (a per-point spatial filter would break segments at tile borders).
DROP TABLE IF EXISTS trajectory_track_stats;
CREATE TABLE trajectory_track_stats (
    dataset_pk integer,
    trajectory_id text DEFAULT '',
    time_min timestamptz,
    time_max timestamptz,
    n_points bigint,
    -- ST_Extent envelope of the track; Geometry (not Polygon) because a
    -- single-fix track's envelope degenerates to a Point.
    bbox geometry(Geometry, 3857),
    -- Median gap between consecutive retained fixes: the platform's TYPICAL
    -- reporting cadence, robust to long idle periods (a mean would conflate
    -- sailing and idle time). Drives the /tiles/tracks gap-split threshold.
    median_gap_secs double precision,
    PRIMARY KEY (dataset_pk, trajectory_id)
);
CREATE INDEX trajectory_track_stats_bbox_gist ON trajectory_track_stats USING GIST (bbox);

-- Aggressive autovacuum on the load-churned tables. Incremental loads
-- DELETE+INSERT each changed dataset's rows; at the default scale factor
-- (0.2) a 780k-row table accrues ~156k dead tuples before autovacuum reacts,
-- which then bursts IO against live web-api traffic. 0.02 makes cleanup
-- small and frequent instead (autovacuum's cost-based throttling paces the
-- IO).
ALTER TABLE cde.profiles SET (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE cde.obis_cells SET (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE cde.trajectory_cells SET (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE cde.points SET (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP MATERIALIZED VIEW IF EXISTS cde.obis_scientific_names;
CREATE MATERIALIZED VIEW cde.obis_scientific_names AS
  SELECT DISTINCT unnest(scientific_names) AS scientific_name
    FROM cde.obis_cells
   WHERE scientific_names IS NOT NULL;

CREATE UNIQUE INDEX ON cde.obis_scientific_names (scientific_name);
CREATE INDEX obis_scientific_names_trgm
  ON cde.obis_scientific_names USING GIN (scientific_name gin_trgm_ops);

-- Per-name OBIS record totals, used by populate_vernaculars.py to order names
-- by popularity (so --top N targets the most-impactful subset). The unnest +
-- GROUP BY over the full obis_cells table is a multi-minute scan, so we cache
-- it as a materialized view rather than recomputing on every script run.
-- Refreshed alongside obis_scientific_names in 5_profile_process.sql.
DROP MATERIALIZED VIEW IF EXISTS cde.obis_scientific_name_popularity;
CREATE MATERIALIZED VIEW cde.obis_scientific_name_popularity AS
  SELECT sn AS scientific_name,
         SUM(c.n_records)::bigint AS total_records
    FROM cde.obis_cells c,
         unnest(c.scientific_names) AS t(sn)
   WHERE c.scientific_names IS NOT NULL
   GROUP BY sn;

CREATE UNIQUE INDEX ON cde.obis_scientific_name_popularity (scientific_name);
CREATE INDEX obis_scientific_name_popularity_total_records
  ON cde.obis_scientific_name_popularity (total_records DESC);


-- Vernacular (common) names per scientific name, sourced from WoRMS.
-- Populated by db-loader/cde_db_loader/populate_vernaculars.py; not written by the harvester.
-- Searches use unnest + ILIKE; with a small row count (one per scientific name)
-- a seq scan is fast enough without a trigram index. Add a denormalised text
-- column + IMMUTABLE wrapper if this ever needs an index.
DROP TABLE IF EXISTS cde.scientific_name_vernaculars;
CREATE TABLE cde.scientific_name_vernaculars (
    scientific_name     text PRIMARY KEY,
    aphia_id            integer,
    rank                text,
    ancestor_aphia_ids  integer[] NOT NULL DEFAULT '{}',
    vernaculars_en      text[]    NOT NULL DEFAULT '{}',
    vernaculars_fr      text[]    NOT NULL DEFAULT '{}',
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    fetch_status        text NOT NULL DEFAULT 'ok'
);

-- GIN index supports the rank-aware filter expansion in web-api/utils/dbFilter.js:
-- given a selected name's aphia_id X, find every taxon whose ancestor chain
-- contains X via :X = ANY(ancestor_aphia_ids).
CREATE INDEX scientific_name_vernaculars_ancestors_gin
  ON cde.scientific_name_vernaculars USING GIN (ancestor_aphia_ids);


--
DROP TABLE IF EXISTS download_jobs;
CREATE TABLE download_jobs (
    pk SERIAL PRIMARY KEY,
    time timestamp with time zone DEFAULT now(),
    job_id text,
    email text,
    status text DEFAULT 'open'::text,
    time_total interval generated always as (time_complete - "time") stored,
    download_size numeric,
    estimate_size numeric,
    estimate_details text,
    erddap_report text,
    time_start timestamp with time zone,
    time_complete timestamp with time zone,
    downloader_input text,
    downloader_output text
);

DROP TABLE IF EXISTS skipped_datasets;
CREATE TABLE skipped_datasets (
    erddap_url text,
    dataset_id text,
    reason_code text
);

DROP TABLE IF EXISTS cde.organizations_lookup;
CREATE TABLE cde.organizations_lookup (
    pk SERIAL PRIMARY KEY,
    name TEXT UNIQUE
);

DROP TABLE IF EXISTS cde.datasets_lookup;
CREATE TABLE cde.datasets_lookup (
    pk serial PRIMARY KEY,
    dataset_id TEXT,
    erddap_url TEXT,
    UNIQUE(dataset_id, erddap_url)
);

-- Harvest audit log: one row per harvester invocation, one row per
-- (dataset, run) attempt. Consumed by the harvest-dashboard service so an
-- ERDDAP admin can self-serve "why didn't my dataset get harvested?".
-- skipped_datasets above is kept as the "current state" view used elsewhere.
DROP TABLE IF EXISTS cde.harvest_attempts;
DROP TABLE IF EXISTS cde.harvest_runs;

CREATE TABLE cde.harvest_runs (
    run_id        uuid PRIMARY KEY,
    started_at    timestamptz NOT NULL,
    finished_at   timestamptz,
    git_sha       text,
    status        text NOT NULL,           -- 'running' | 'ok' | 'failed'
    error_message text,
    prefect_flow_run_id text,              -- Prefect flow run id (dashboard deep-links to the Prefect UI); null for CLI runs
    scope         text,                    -- 'full' (all sources) | 'single' (one source)
    triggered_source text,                 -- the requested source (erddap url or 'obis') for single-source runs
    triggered_by  text                     -- dashboard user who launched it (Cloudflare Access email), if any
);
CREATE INDEX harvest_runs_started_at_idx
    ON cde.harvest_runs (started_at DESC);
-- NOTE: applying this file DROP/CREATEs harvest_runs (wiping audit history). To
-- add the columns above to a LIVE database without dropping it, run the
-- idempotent migration in database/migrations/add-harvest-run-prefect-columns.sql.

CREATE TABLE cde.harvest_attempts (
    run_id        uuid NOT NULL REFERENCES cde.harvest_runs(run_id) ON DELETE CASCADE,
    erddap_url    text NOT NULL,
    dataset_id    text NOT NULL,
    source        text NOT NULL,           -- 'erddap' | 'obis'
    status        text NOT NULL,           -- 'success' | 'skipped' | 'error'
    reason_code   text,                    -- one of harvest_errors.* when not success
    error_message text,
    duration_ms   integer,
    attempted_at  timestamptz NOT NULL,
    -- Newline-joined list of every URL the harvester fired for this
    -- dataset (info/<id>/index.csv, tabledap/<id>.csv?…). The dashboard
    -- splits on \n and renders each as a clickable link so an admin can
    -- replay the exact requests to debug a failure.
    query_urls    text,
    -- Non-fatal note for an otherwise-successful dataset, surfaced on the
    -- harvest dashboard (e.g. features hidden from the map because they span
    -- a region larger than the point threshold).
    warnings      text,
    PRIMARY KEY (run_id, erddap_url, dataset_id)
);
CREATE INDEX harvest_attempts_dataset_idx
    ON cde.harvest_attempts (erddap_url, dataset_id, attempted_at DESC);
CREATE INDEX harvest_attempts_status_idx
    ON cde.harvest_attempts (status);
CREATE INDEX harvest_attempts_attempted_at_idx
    ON cde.harvest_attempts (attempted_at DESC);