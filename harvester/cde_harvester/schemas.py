"""Pandera schemas for harvester DataFrames.

These define the column contract that all harvesters must produce.
Column names and types mirror database/1_schema.sql where applicable.
"""

import pandera as pa
from pandera.typing import Series


class ProfileSchema(pa.DataFrameModel):
    """Schema for the profiles DataFrame.

    Mirrors cde.profiles in the database.
    """

    erddap_url: Series[str]
    dataset_id: Series[str]
    timeseries_id: Series[str] = pa.Field(nullable=True, default="")
    profile_id: Series[str] = pa.Field(nullable=True, default="")
    latitude: Series[float] = pa.Field(ge=-90, le=90)
    longitude: Series[float] = pa.Field(ge=-180, le=180)
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
