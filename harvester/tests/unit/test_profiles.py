"""
Unit tests for the shared tabledap feature pipeline (dataset_types.tabledap_features).

Uses a fully-configured MagicMock dataset so that extract_features can exercise
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
from cde_harvester.dataset_types import extract_features as get_profiles


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
    """Dataset whose single feature has a latitude out of valid range.

    The bad coordinate now comes from the feature's bounding box (the
    single-feature metadata shortcut), not get_profile_ids — that's where the
    pipeline sources lat/lon since the bbox change.
    """
    df_vars = single_station_dataset.df_variables
    df_vars.loc["latitude", "actual_range"] = "95.0,95.0"   # > 90 → invalid
    df_vars.loc["longitude", "actual_range"] = "-125.0,-125.0"
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


class TestBoundingBoxAndDisplayFlag:
    def test_bbox_columns_present(self, single_station_dataset):
        result = get_profiles(single_station_dataset)
        for col in ["latitude_min", "latitude_max", "longitude_min",
                    "longitude_max", "show_as_point"]:
            assert col in result.columns, f"Missing column: {col}"

    def test_fixed_station_is_a_point(self, single_station_dataset):
        """A fixed station (lat_min==lat_max) shows as a dot."""
        result = get_profiles(single_station_dataset)
        assert result["show_as_point"].all()
        assert (result["latitude_min"] == result["latitude_max"]).all()
        assert result["latitude"].iloc[0] == pytest.approx(48.5)

    def test_region_feature_hidden_from_map(self, single_station_dataset):
        """A feature whose box spans >1 km is kept (searchable) but flagged
        show_as_point=False so it's not drawn on the map."""
        df_vars = single_station_dataset.df_variables
        # ~1 degree of latitude ≈ 111 km — well over the 1 km threshold.
        df_vars.loc["latitude", "actual_range"] = "48.0,49.0"
        df_vars.loc["longitude", "actual_range"] = "-125.0,-125.0"
        result = get_profiles(single_station_dataset)
        assert not result.empty
        assert not result["show_as_point"].any()
        # midpoint stored as the representative point
        assert result["latitude"].iloc[0] == pytest.approx(48.5)


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
