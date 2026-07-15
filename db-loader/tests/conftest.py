"""
Shared fixtures for the db-loader test suite.
"""

import pandas as pd
import pytest

DATASET_ID = "test_timeseries_001"
ERDDAP_URL = "https://test.erddap.com/erddap"
DOMAIN = "test.erddap.com"


@pytest.fixture
def sample_datasets_df():
    """A minimal datasets DataFrame as produced by the harvester."""
    return pd.DataFrame(
        {
            "title": ["Test Temperature Dataset"],
            "erddap_url": [ERDDAP_URL],
            "dataset_id": [DATASET_ID],
            "cdm_data_type": ["TimeSeries"],
            "platform": ["unknown"],
            "eovs": [["seaSurfaceTemperature"]],
            "organizations": [["Test Institution"]],
            "n_profiles": [1],
            "profile_variables": [["station_id"]],
            "timeseries_id_variable": ["station_id"],
            "profile_id_variable": [None],
            "trajectory_id_variable": [None],
            "num_columns": [6],
            "first_eov_column": ["temperature"],
        }
    )


@pytest.fixture
def sample_profiles_df():
    """A minimal profiles DataFrame as produced by get_profiles."""
    return pd.DataFrame(
        {
            "timeseries_id": ["STATION_001"],
            "profile_id": [""],
            "latitude": [48.5],
            "longitude": [-125.0],
            "time_min": [pd.Timestamp("2020-01-01", tz="UTC")],
            "time_max": [pd.Timestamp("2023-12-31", tz="UTC")],
            "depth_min": [0.5],
            "depth_max": [200.5],
            "n_records": [1000.0],
            "records_per_day": [0.7519],
            "dataset_id": [DATASET_ID],
            "erddap_url": [ERDDAP_URL],
        }
    )


@pytest.fixture
def sample_skipped_df():
    """Skipped datasets DataFrame."""
    return pd.DataFrame(
        {
            "erddap_url": [DOMAIN],
            "dataset_id": ["skipped_001"],
            "reason_code": ["NO_SUPPORTED_VARIABLES"],
        }
    )
