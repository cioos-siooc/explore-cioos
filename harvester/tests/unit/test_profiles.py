"""
Unit tests for cde_harvester.profiles.get_profiles.

Uses a fully-configured MagicMock dataset so that get_profiles can exercise
its real logic (DataFrame manipulation, bad-geometry filtering, etc.) without
any HTTP calls.
"""

import pandas as pd
import pytest

from conftest import (
    DATASET_ID,
    ERDDAP_PROFILE_IDS_CSV,
    ERDDAP_URL,
    build_mock_dataset,
)
from cde_harvester.profiles import get_profiles


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def single_station_dataset():
    """Mock dataset with a single TimeSeries station — uses actual_range path."""
    return build_mock_dataset()


@pytest.fixture
def no_profile_dataset(single_station_dataset):
    """Dataset whose get_profile_ids() returns an empty DataFrame."""
    single_station_dataset.get_profile_ids.return_value = pd.DataFrame()
    return single_station_dataset


@pytest.fixture
def bad_geometry_dataset(single_station_dataset):
    """Dataset whose single profile has a latitude out of valid range."""
    bad_ids = pd.DataFrame({
        "station_id": ["BAD_STATION"],
        "latitude": [95.0],   # > 90 → invalid
        "longitude": [-125.0],
    })
    single_station_dataset.get_profile_ids.return_value = bad_ids
    single_station_dataset.profile_ids = bad_ids
    return single_station_dataset


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestGetProfilesHappyPath:
    def test_returns_dataframe(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert isinstance(result, pd.DataFrame)

    def test_result_is_not_empty(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert not result.empty

    def test_required_columns_present(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        required = [
            "timeseries_id", "latitude", "longitude",
            "time_min", "time_max", "depth_min", "depth_max",
            "n_records", "records_per_day", "dataset_id", "erddap_url",
        ]
        for col in required:
            assert col in result.columns, f"Missing column: {col}"

    def test_dataset_id_matches(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert (result["dataset_id"] == DATASET_ID).all()

    def test_erddap_url_matches(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert (result["erddap_url"] == ERDDAP_URL).all()

    def test_latitude_preserved(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert result["latitude"].iloc[0] == pytest.approx(48.5)

    def test_longitude_preserved(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert result["longitude"].iloc[0] == pytest.approx(-125.0)

    def test_time_min_is_datetime(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert pd.api.types.is_datetime64_any_dtype(result["time_min"])

    def test_depth_defaults_to_zero_when_no_depth_var(self, single_station_dataset):
        """If the dataset has no depth variable, depth_min and depth_max default to 0."""
        single_station_dataset.variables_list = [
            v for v in single_station_dataset.variables_list if v != "depth"
        ]
        result = get_profiles(single_station_dataset)
        assert not result.empty
        assert (result["depth_min"] == 0).all()
        assert (result["depth_max"] == 0).all()

    def test_records_per_day_is_positive(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        assert (result["records_per_day"] > 0).all()


class TestGetProfilesEmptyAndEdgeCases:
    def test_empty_profile_ids_returns_empty(self, no_profile_dataset):
        result = get_profiles(no_profile_dataset)
        assert result.empty

    def test_bad_latitude_profile_filtered_out(self, bad_geometry_dataset):
        """Profiles with latitude > 90 must be removed by the bad-geometry filter."""
        result = get_profiles(bad_geometry_dataset)
        assert result.empty

    def test_profile_id_column_added_when_missing(self, single_station_dataset):
        """timeSeries datasets have no profile_id variable; it should default to empty string."""
        result = get_profiles(single_station_dataset)
        assert "profile_id" in result.columns
        assert (result["profile_id"] == "").all()
