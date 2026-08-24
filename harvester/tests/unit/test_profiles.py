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


# ---------------------------------------------------------------------------
# Per-feature EOV detection
# ---------------------------------------------------------------------------

@pytest.fixture
def two_station_dataset(single_station_dataset):
    """Two stations, where only STATION_001 carries oxygen.

    get_count answers the way ERDDAP's orderByCount does: one non-null count
    column per requested variable, grouped by the feature identity.
    """
    dataset = single_station_dataset
    stations = ["STATION_001", "STATION_002"]

    profile_ids = pd.DataFrame(
        {
            "station_id": stations,
            "latitude": [48.5, 49.5],
            "longitude": [-125.0, -126.0],
        }
    )
    dataset.profile_ids = profile_ids
    dataset.get_profile_ids.return_value = profile_ids.copy()

    def _get_max_min(vars_list):
        last_var = vars_list[-1]
        index_vars = vars_list[:-1]
        if last_var == "time":
            data = {
                "station_id": stations,
                "time_min": ["2020-01-01T00:00:00Z"] * 2,
                "time_max": ["2023-12-31T00:00:00Z"] * 2,
            }
        elif last_var == "latitude":
            data = {
                "station_id": stations,
                "latitude_min": [48.5, 49.5],
                "latitude_max": [48.5, 49.5],
            }
        elif last_var == "longitude":
            data = {
                "station_id": stations,
                "longitude_min": [-125.0, -126.0],
                "longitude_max": [-125.0, -126.0],
            }
        else:
            data = {
                "station_id": stations,
                f"{last_var}_min": [0.5, 0.5],
                f"{last_var}_max": [200.5, 200.5],
            }
        return pd.DataFrame(data).set_index(index_vars)

    dataset.get_max_min.side_effect = _get_max_min

    # temperature is measured at both stations, oxygen only at the first.
    dataset.get_eov_variables.return_value = {
        "temperature": ["subSurfaceTemperature"],
        "oxygen": ["oxygen"],
    }

    def _get_count(variables, groupby, time_min, time_max):
        counts = {"station_id": stations, "time": [1000, 800], "depth": [1000, 800]}
        if "temperature" in variables:
            counts["temperature"] = [1000, 800]
        if "oxygen" in variables:
            counts["oxygen"] = [1000, 0]
        return pd.DataFrame(counts)

    dataset.get_count.side_effect = _get_count
    dataset.eovs = ["oxygen", "subSurfaceTemperature"]
    return dataset


class TestPerFeatureEovs:
    def test_eovs_column_present(self, two_station_dataset):
        result = get_profiles(two_station_dataset)
        assert "eovs" in result.columns

    def test_station_without_oxygen_excludes_it(self, two_station_dataset):
        result = get_profiles(two_station_dataset).set_index("timeseries_id")
        assert result.loc["STATION_001", "eovs"] == [
            "oxygen",
            "subSurfaceTemperature",
        ]
        assert result.loc["STATION_002", "eovs"] == ["subSurfaceTemperature"]

    def test_feature_eovs_never_exceed_dataset_eovs(self, two_station_dataset):
        result = get_profiles(two_station_dataset)
        for eovs in result["eovs"]:
            assert set(eovs) <= set(two_station_dataset.eovs)

    def test_n_records_ignores_eov_count_columns(self, two_station_dataset):
        """Regression: n_records is a record count, so it must keep ranging
        over time/depth/cf-role only — the EOV columns joining the same
        request must not change it."""
        with_eovs = get_profiles(two_station_dataset).set_index("timeseries_id")

        two_station_dataset.get_eov_variables.return_value = {}
        without_eovs = get_profiles(two_station_dataset).set_index("timeseries_id")

        assert list(with_eovs["n_records"]) == list(without_eovs["n_records"])
        assert with_eovs.loc["STATION_001", "n_records"] == 1000
        assert with_eovs.loc["STATION_002", "n_records"] == 800

    def test_widened_count_failure_falls_back_to_dataset_eovs(
        self, two_station_dataset
    ):
        """The widened request can fail where the narrow one succeeds. The
        dataset must survive, and every feature must inherit the dataset's
        EOVs rather than ending up with an empty list."""
        stations = ["STATION_001", "STATION_002"]

        def _get_count(variables, groupby, time_min, time_max):
            if "oxygen" in variables:
                return pd.DataFrame()
            return pd.DataFrame(
                {"station_id": stations, "time": [1000, 800], "depth": [1000, 800]}
            )

        two_station_dataset.get_count.side_effect = _get_count
        result = get_profiles(two_station_dataset)

        assert len(result) == 2
        for eovs in result["eovs"]:
            assert eovs == two_station_dataset.eovs

    def test_feature_with_no_counts_falls_back_to_dataset_eovs(
        self, two_station_dataset
    ):
        """A feature whose EOV variables are all zero keeps the dataset's list:
        an empty array would hide it from the web-api's overlap filter."""
        stations = ["STATION_001", "STATION_002"]

        def _get_count(variables, groupby, time_min, time_max):
            counts = {"station_id": stations, "time": [1000, 800], "depth": [1000, 800]}
            if "temperature" in variables:
                counts["temperature"] = [1000, 0]
            if "oxygen" in variables:
                counts["oxygen"] = [1000, 0]
            return pd.DataFrame(counts)

        two_station_dataset.get_count.side_effect = _get_count
        result = get_profiles(two_station_dataset).set_index("timeseries_id")
        assert result.loc["STATION_002", "eovs"] == two_station_dataset.eovs

    def test_single_feature_dataset_inherits_dataset_eovs(
        self, single_station_dataset
    ):
        """One feature is the dataset, so detection is skipped entirely — that
        also sidesteps get_count's single-feature shortcuts, which return a
        time-only or window-limited frame."""
        result = get_profiles(single_station_dataset)
        assert list(result["eovs"].iloc[0]) == list(single_station_dataset.eovs)
        single_station_dataset.get_eov_variables.assert_not_called()
