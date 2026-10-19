"""Column contract between the harvesters and the db-loader; a schema change
touches this file and database/1_schema.sql."""

import pandera.pandas as pa
from pandera.typing import Series
from sqlalchemy.dialects.postgresql import ARRAY, DATERANGE, INTEGER, JSONB, TEXT

DATASET_ARRAY_DTYPES = {
    "eovs": ARRAY(TEXT),
    "organizations": ARRAY(TEXT),
    "profile_variables": ARRAY(TEXT),
    "organization_pks": ARRAY(INTEGER),
    "obis_nodes": ARRAY(TEXT),
    "table_variables": JSONB,
    "grid_variables": JSONB,
    "grid_dimensions": JSONB,
    # Descriptive record metadata (core/record_metadata.py): a dict -> jsonb.
    "metadata": JSONB,
}

PROFILE_ARRAY_DTYPES = {
    "eovs": ARRAY(TEXT),
    # psycopg2 range objects: binding does not coerce text[] to daterange[].
    "day_ranges": ARRAY(DATERANGE),
}

OBIS_ARRAY_DTYPES = {
    "scientific_names": ARRAY(TEXT),
    "aphia_ids": ARRAY(INTEGER),
}


class ProfileSchema(pa.DataFrameModel):
    """Mirrors cde.profiles."""

    erddap_url: Series[str]
    dataset_id: Series[str]
    timeseries_id: Series[str] = pa.Field(nullable=True, default="")
    profile_id: Series[str] = pa.Field(nullable=True, default="")
    # Display point (exact location, or the bbox midpoint).
    latitude: Series[float] = pa.Field(ge=-90, le=90)
    longitude: Series[float] = pa.Field(ge=-180, le=180)
    # Spatial search matches this extent, not the display point.
    latitude_min: Series[float] = pa.Field(ge=-90, le=90)
    latitude_max: Series[float] = pa.Field(ge=-90, le=90)
    longitude_min: Series[float] = pa.Field(ge=-180, le=180)
    longitude_max: Series[float] = pa.Field(ge=-180, le=180)
    # False = box diagonal > POINT_THRESHOLD_M: in hexes but not drawn as a dot.
    show_as_point: Series[bool] = pa.Field(nullable=False, default=True)
    depth_min: Series[float] = pa.Field(nullable=True)
    depth_max: Series[float] = pa.Field(nullable=True)
    time_min: Series[pa.DateTime] = pa.Field(nullable=True)
    time_max: Series[pa.DateTime] = pa.Field(nullable=True)
    n_records: Series[float] = pa.Field(nullable=True)
    # Mean over days that HAVE data, not the elapsed span
    # (web-api/utils/shapeQuery.js relies on it).
    records_per_day: Series[float] = pa.Field(nullable=True)
    n_profiles: Series[float] = pa.Field(nullable=True)
    # Distinct UTC days, and the same set as maximal runs. The map UNIONS
    # day_ranges rather than summing `days`. Both NULL for single-day feature
    # types; the database fills `days` from the time span there.
    days: Series[float] = pa.Field(nullable=True)
    day_ranges: Series[object] = pa.Field(nullable=True)
    # Subset of the dataset's eovs; never empty (falls back to the dataset's
    # list): the web-api's array overlap would hide the feature from every EOV.
    eovs: Series[object] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class ObisCellSchema(pa.DataFrameModel):
    """Mirrors cde.obis_cells."""

    dataset_id: Series[str]
    latitude: Series[float] = pa.Field(ge=-90, le=90)
    longitude: Series[float] = pa.Field(ge=-180, le=180)
    scientific_names: Series[object]
    n_records: Series[float] = pa.Field(nullable=True)
    days: Series[float] = pa.Field(nullable=True)
    day_ranges: Series[object] = pa.Field(nullable=True)
    time_min: Series[pa.DateTime] = pa.Field(nullable=True)
    time_max: Series[pa.DateTime] = pa.Field(nullable=True)
    depth_min: Series[float] = pa.Field(nullable=True)
    depth_max: Series[float] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class TrajectoryDaySchema(pa.DataFrameModel):
    """Mirrors cde.trajectory_days: one row per (trajectory, UTC day).
    Attribute-only; location comes from TrajectoryPointSchema."""

    erddap_url: Series[str]
    dataset_id: Series[str]
    trajectory_id: Series[str] = pa.Field(nullable=True, default="")
    day: Series[pa.DateTime]
    n_records: Series[float] = pa.Field(nullable=True)
    n_profiles: Series[float] = pa.Field(nullable=True)
    depth_min: Series[float] = pa.Field(nullable=True)
    depth_max: Series[float] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class TrajectoryPointSchema(pa.DataFrameModel):
    """Mirrors cde.trajectory_points: downsampled raw fixes. The database sweeps
    the segments between them through the hex grid, so their spacing sets the
    coverage layer's resolution."""

    erddap_url: Series[str]
    dataset_id: Series[str]
    trajectory_id: Series[str] = pa.Field(nullable=True, default="")
    profile_id: Series[str] = pa.Field(nullable=True)
    time: Series[pa.DateTime]
    latitude: Series[float] = pa.Field(ge=-90, le=90)
    longitude: Series[float] = pa.Field(ge=-180, le=180)

    class Config:
        coerce = True
        strict = False


class DatasetSchema(pa.DataFrameModel):
    """Mirrors cde.datasets."""

    title: Series[str] = pa.Field(nullable=True)
    erddap_url: Series[str]
    dataset_id: Series[str]
    cdm_data_type: Series[str] = pa.Field(nullable=True)
    platform: Series[str] = pa.Field(nullable=True)
    eovs: Series[object]
    organizations: Series[object]
    n_profiles: Series[float] = pa.Field(nullable=True)
    profile_variables: Series[object]
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
    # Griddap only.
    coverage_lat_min: Series[float] = pa.Field(nullable=True)
    coverage_lat_max: Series[float] = pa.Field(nullable=True)
    coverage_lon_min: Series[float] = pa.Field(nullable=True)
    coverage_lon_max: Series[float] = pa.Field(nullable=True)
    coverage_time_min: Series[pa.DateTime] = pa.Field(nullable=True)
    coverage_time_max: Series[pa.DateTime] = pa.Field(nullable=True)
    coverage_depth_min: Series[float] = pa.Field(nullable=True)
    coverage_depth_max: Series[float] = pa.Field(nullable=True)
    table_variables: Series[object] = pa.Field(nullable=True)
    grid_variables: Series[object] = pa.Field(nullable=True)
    grid_dimensions: Series[object] = pa.Field(nullable=True)
    wms_url: Series[str] = pa.Field(nullable=True)
    metadata: Series[object] = pa.Field(nullable=True)  # dict -> jsonb

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
    """No DB table; internal to harvesting."""

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
    """Mirrors cde.skipped_datasets."""

    erddap_url: Series[str]
    dataset_id: Series[str]
    reason_code: Series[str]

    class Config:
        coerce = True
        strict = False


class HarvestRunSchema(pa.DataFrameModel):
    """Mirrors cde.harvest_runs."""

    run_id: Series[str]
    started_at: Series[pa.DateTime]
    finished_at: Series[pa.DateTime] = pa.Field(nullable=True)
    git_sha: Series[str] = pa.Field(nullable=True)
    status: Series[str]
    error_message: Series[str] = pa.Field(nullable=True)
    prefect_flow_run_id: Series[str] = pa.Field(nullable=True)
    # 'full' or 'single'. triggered_by: the dashboard user's Cloudflare-Access
    # email, if any.
    scope: Series[str] = pa.Field(nullable=True)
    triggered_source: Series[str] = pa.Field(nullable=True)
    triggered_by: Series[str] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False


class HarvestAttemptSchema(pa.DataFrameModel):
    """Mirrors cde.harvest_attempts."""

    run_id: Series[str]
    erddap_url: Series[str]
    dataset_id: Series[str]
    source: Series[str]
    status: Series[str]                                 # 'success' | 'skipped' | 'error'
    reason_code: Series[str] = pa.Field(nullable=True)  # set when status != 'success'
    error_message: Series[str] = pa.Field(nullable=True)
    duration_ms: Series[float] = pa.Field(nullable=True)
    attempted_at: Series[pa.DateTime]
    # Newline-joined, text not text[]; the dashboard splits it.
    query_urls: Series[str] = pa.Field(nullable=True)
    warnings: Series[str] = pa.Field(nullable=True)

    class Config:
        coerce = True
        strict = False
