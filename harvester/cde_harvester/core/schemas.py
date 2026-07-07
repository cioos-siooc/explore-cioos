"""Pandera schemas for harvester DataFrames.

These define the column contract that all harvesters must produce and the
db-loader consumes. Column names and types mirror database/1_schema.sql where
applicable — a schema change touches three places: this file, 1_schema.sql
(fresh installs) and an idempotent database/migrations/*.sql (live DBs).
"""

import pandera as pa
from pandera.typing import Series
from sqlalchemy.dialects.postgresql import ARRAY, INTEGER, JSONB, TEXT

# --- Loader-side column metadata ------------------------------------------
# List-valued columns are serialized by the harvester as Python-repr strings in
# the CSVs; the loader parses them back (ast.literal_eval) and writes them as
# PostgreSQL arrays with these dtypes. Kept here, next to the schemas, so the
# CSV contract has a single home.

DATASET_ARRAY_DTYPES = {
    "eovs": ARRAY(TEXT),
    "organizations": ARRAY(TEXT),
    "profile_variables": ARRAY(TEXT),
    "organization_pks": ARRAY(INTEGER),
    "obis_nodes": ARRAY(TEXT),
    # Griddap metadata: lists of dicts, stored as jsonb.
    "grid_variables": JSONB,
    "grid_dimensions": JSONB,
}

OBIS_ARRAY_DTYPES = {
    "scientific_names": ARRAY(TEXT),
    "aphia_ids": ARRAY(INTEGER),
}


class ProfileSchema(pa.DataFrameModel):
    """Schema for the profiles DataFrame.

    Mirrors cde.profiles in the database.
    """

    erddap_url: Series[str]
    dataset_id: Series[str]
    timeseries_id: Series[str] = pa.Field(nullable=True, default="")
    profile_id: Series[str] = pa.Field(nullable=True, default="")
    # Representative display point (exact location, or the bbox midpoint).
    latitude: Series[float] = pa.Field(ge=-90, le=90)
    longitude: Series[float] = pa.Field(ge=-180, le=180)
    # Per-feature lat/lon bounding box; the DB derives an indexed bbox geometry
    # from these and spatial search matches against it (feature extent, not the
    # single display point).
    latitude_min: Series[float] = pa.Field(ge=-90, le=90)
    latitude_max: Series[float] = pa.Field(ge=-90, le=90)
    longitude_min: Series[float] = pa.Field(ge=-180, le=180)
    longitude_max: Series[float] = pa.Field(ge=-180, le=180)
    # False = feature spans a region (box diagonal > POINT_THRESHOLD_M): kept
    # searchable + aggregated in hexes, but not drawn as an individual dot.
    show_as_point: Series[bool] = pa.Field(nullable=False, default=True)
    depth_min: Series[float] = pa.Field(nullable=True)
    depth_max: Series[float] = pa.Field(nullable=True)
    time_min: Series[pa.DateTime] = pa.Field(nullable=True)
    time_max: Series[pa.DateTime] = pa.Field(nullable=True)
    n_records: Series[float] = pa.Field(nullable=True)
    records_per_day: Series[float] = pa.Field(nullable=True)
    n_profiles: Series[float] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False  # allow extra columns during transition


class ObisCellSchema(pa.DataFrameModel):
    """Schema for the obis_cells DataFrame.

    Mirrors cde.obis_cells in the database.
    """

    dataset_id: Series[str]
    latitude: Series[float] = pa.Field(ge=-90, le=90)
    longitude: Series[float] = pa.Field(ge=-180, le=180)
    scientific_names: Series[object]  # list column, stored as text[] in DB
    n_records: Series[float] = pa.Field(nullable=True)
    time_min: Series[pa.DateTime] = pa.Field(nullable=True)
    time_max: Series[pa.DateTime] = pa.Field(nullable=True)
    depth_min: Series[float] = pa.Field(nullable=True)
    depth_max: Series[float] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class TrajectoryCellSchema(pa.DataFrameModel):
    """Schema for the trajectory_cells DataFrame.

    Mirrors cde.trajectory_cells in the database: one row per
    (trajectory, 1/12-degree grid cell) a Trajectory/TrajectoryProfile
    dataset's track passes through.
    """

    erddap_url: Series[str]
    dataset_id: Series[str]
    trajectory_id: Series[str] = pa.Field(nullable=True, default="")
    latitude: Series[float] = pa.Field(ge=-90, le=90)
    longitude: Series[float] = pa.Field(ge=-180, le=180)
    time_min: Series[pa.DateTime] = pa.Field(nullable=True)
    time_max: Series[pa.DateTime] = pa.Field(nullable=True)
    depth_min: Series[float] = pa.Field(nullable=True)
    depth_max: Series[float] = pa.Field(nullable=True)
    n_records: Series[float] = pa.Field(nullable=True)
    n_profiles: Series[float] = pa.Field(nullable=True)
    records_per_day: Series[float] = pa.Field(nullable=True)
    days: Series[float] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class DatasetSchema(pa.DataFrameModel):
    """Schema for the datasets DataFrame.

    Mirrors cde.datasets in the database.
    """

    title: Series[str] = pa.Field(nullable=True)
    erddap_url: Series[str]
    dataset_id: Series[str]
    cdm_data_type: Series[str] = pa.Field(nullable=True)
    platform: Series[str] = pa.Field(nullable=True)
    eovs: Series[object]  # list column, stored as text[] in DB
    organizations: Series[object]  # list column, stored as text[] in DB
    n_profiles: Series[float] = pa.Field(nullable=True)
    profile_variables: Series[object]  # list column
    timeseries_id_variable: Series[str] = pa.Field(nullable=True)
    profile_id_variable: Series[str] = pa.Field(nullable=True)
    trajectory_id_variable: Series[str] = pa.Field(nullable=True)
    num_columns: Series[float] = pa.Field(nullable=True)
    first_eov_column: Series[str] = pa.Field(nullable=True)
    source_type: Series[str] = pa.Field(nullable=True, default="erddap")
    content_hash: Series[str] = pa.Field(nullable=True)
    content_hash_reason: Series[str] = pa.Field(nullable=True)
    last_updated_at: Series[pa.DateTime] = pa.Field(nullable=True)
    verified_at: Series[pa.DateTime] = pa.Field(nullable=True)
    # Griddap (metadata-only) coverage + structure; None for all other types.
    coverage_lat_min: Series[float] = pa.Field(nullable=True)
    coverage_lat_max: Series[float] = pa.Field(nullable=True)
    coverage_lon_min: Series[float] = pa.Field(nullable=True)
    coverage_lon_max: Series[float] = pa.Field(nullable=True)
    coverage_time_min: Series[pa.DateTime] = pa.Field(nullable=True)
    coverage_time_max: Series[pa.DateTime] = pa.Field(nullable=True)
    coverage_depth_min: Series[float] = pa.Field(nullable=True)
    coverage_depth_max: Series[float] = pa.Field(nullable=True)
    grid_variables: Series[object] = pa.Field(nullable=True)  # list of dicts -> jsonb
    grid_dimensions: Series[object] = pa.Field(nullable=True)  # list of dicts -> jsonb
    wms_url: Series[str] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class VerifiedDatasetSchema(pa.DataFrameModel):
    """Datasets skipped as unchanged; drives the db-loader's verified_at bump."""

    erddap_url: Series[str]
    dataset_id: Series[str]
    verified_at: Series[pa.DateTime]

    class Config:
        coerce = True
        strict = False


class VariableSchema(pa.DataFrameModel):
    """Schema for the variables DataFrame.

    No corresponding DB table — used internally during harvesting.
    """

    name: Series[str]
    type: Series[str] = pa.Field(nullable=True)
    cf_role: Series[str] = pa.Field(nullable=True)
    standard_name: Series[str] = pa.Field(nullable=True)
    erddap_url: Series[str]
    dataset_id: Series[str]

    class Config:
        coerce = True
        strict = False


class SkippedDatasetSchema(pa.DataFrameModel):
    """Schema for the skipped datasets DataFrame.

    Mirrors cde.skipped_datasets in the database.
    """

    erddap_url: Series[str]
    dataset_id: Series[str]
    reason_code: Series[str]

    class Config:
        coerce = True
        strict = False


class HarvestRunSchema(pa.DataFrameModel):
    """Schema for the harvest_runs DataFrame (one row per harvester invocation).

    Mirrors cde.harvest_runs in the database.
    """

    run_id: Series[str]
    started_at: Series[pa.DateTime]
    finished_at: Series[pa.DateTime] = pa.Field(nullable=True)
    git_sha: Series[str] = pa.Field(nullable=True)
    status: Series[str]
    error_message: Series[str] = pa.Field(nullable=True)
    # Prefect flow-run id for this harvest, so the dashboard can deep-link to
    # the Prefect UI. Null for bare-CLI runs (no flow context).
    prefect_flow_run_id: Series[str] = pa.Field(nullable=True)
    # 'full' (all configured sources) or 'single' (one source). triggered_source
    # is the requested source (erddap url or 'obis'); triggered_by is the user
    # who launched it from the dashboard (Cloudflare-Access email), if any.
    scope: Series[str] = pa.Field(nullable=True)
    triggered_source: Series[str] = pa.Field(nullable=True)
    triggered_by: Series[str] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class HarvestAttemptSchema(pa.DataFrameModel):
    """Schema for the harvest_attempts DataFrame (one row per dataset per run).

    Mirrors cde.harvest_attempts in the database.
    """

    run_id: Series[str]
    erddap_url: Series[str]
    dataset_id: Series[str]
    source: Series[str]
    status: Series[str]                                 # 'success' | 'skipped' | 'error'
    reason_code: Series[str] = pa.Field(nullable=True)  # set when status != 'success'
    error_message: Series[str] = pa.Field(nullable=True)
    duration_ms: Series[float] = pa.Field(nullable=True)
    attempted_at: Series[pa.DateTime]
    # Newline-joined URLs the harvester fired for this dataset. Stored as
    # text (not text[]) because pandas + to_sql array handling needs custom
    # dtypes; a newline-delimited blob is plenty for "show the admin what
    # we asked for". Splitter lives in the dashboard.
    query_urls: Series[str] = pa.Field(nullable=True)
    # Non-fatal note for an otherwise-successful dataset, shown on the harvest
    # dashboard (e.g. features hidden from the map because they span a region).
    warnings: Series[str] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False
