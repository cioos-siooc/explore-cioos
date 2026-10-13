"""
Unit tests for the shared tabledap feature pipeline (dataset_types.tabledap_features).

Uses a fully-configured MagicMock dataset so that extract_features can exercise
its real logic (DataFrame manipulation, bad-geometry filtering, etc.) without
any HTTP calls.
"""

import pandas as pd
import pytest
from cde_harvester.dataset_types import extract_features as get_profiles
from cde_harvester.dataset_types import timeseries_profile
from conftest import (
    DATASET_ID,
    ERDDAP_URL,
    build_mock_dataset,
)

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

    def test_unparseable_time_feature_filtered_out(self, single_station_dataset):
        """A time pandas can't represent (year 0019, a typo for 2019) coerces
        to NaT; the feature must go here so the dataset is skipped, not loaded
        with a feature the db-loader then silently drops."""
        single_station_dataset.df_variables.loc["time", "actual_range"] = (
            "0019-06-24T00:20:00Z,0019-11-01T07:40:00Z"
        )
        max_min = single_station_dataset.get_max_min.side_effect

        def _year_0019_times(vars_list):
            df = max_min(vars_list)
            if vars_list[-1] == "time":
                df["time_min"] = "0019-06-24T00:20:00Z"
                df["time_max"] = "0019-11-01T07:40:00Z"
            return df

        single_station_dataset.get_max_min.side_effect = _year_0019_times
        result = get_profiles(single_station_dataset)
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


# ---------------------------------------------------------------------------
# Metadata first: fewer full-data scans
# ---------------------------------------------------------------------------

STATIONS = ["STATION_001", "STATION_002"]


def _stations_max_min(stations):
    """get_max_min answering for every station, as orderByMinMax does."""
    bounds = {
        "time": ("2020-01-01T00:00:00Z", "2023-12-31T00:00:00Z"),
        "latitude": (48.5, 48.5),
        "longitude": (-125.0, -125.0),
    }

    def _get_max_min(vars_list):
        last_var = vars_list[-1]
        low, high = bounds.get(last_var, (0.5, 200.5))
        return pd.DataFrame({
            "station_id": stations,
            f"{last_var}_min": [low] * len(stations),
            f"{last_var}_max": [high] * len(stations),
        }).set_index(vars_list[:-1])

    return _get_max_min


def _day_count(rows):
    """A per-day orderByCount response, the grouped time column carrying the
    bucket INDEX the way ERDDAP returns it."""
    frame = pd.DataFrame(
        rows, columns=["station_id", "day", "latitude", "depth", "temperature", "oxygen"]
    )
    index = (pd.to_datetime(frame.pop("day")) - pd.Timestamp("1970-01-01")).dt.days
    frame.insert(1, "time", pd.to_datetime(index, unit="s").dt.strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    ))
    return frame


def _counting_queries(dataset):
    return [
        call.args[0] for call in dataset.dataset_tabledap_query.call_args_list
        if "orderByCount" in call.args[0]
    ]


class TestMergedDayCount:
    """Without a resolution, one per-day orderByCount answers the day set, the
    record count and the per-feature EOVs; no separate get_count scan."""

    @pytest.fixture
    def dataset(self, two_station_dataset):
        two_station_dataset.dataset_tabledap_query.side_effect = lambda url: _day_count([
            ("STATION_001", "2020-03-01", 10, 12, 12, 12),
            ("STATION_001", "2020-03-02", 5, 5, 5, 0),
            ("STATION_002", "2020-03-01", 7, 7, 7, 0),
        ])
        return two_station_dataset

    def test_get_count_is_not_called(self, dataset):
        get_profiles(dataset)
        dataset.get_count.assert_not_called()
        assert len(_counting_queries(dataset)) == 1

    def test_n_records_sums_the_daily_record_counts(self, dataset):
        result = get_profiles(dataset).set_index("timeseries_id")
        assert result.loc["STATION_001", "n_records"] == 17
        assert result.loc["STATION_002", "n_records"] == 7

    def test_days_and_eovs_come_from_the_same_response(self, dataset):
        result = get_profiles(dataset).set_index("timeseries_id")
        assert result.loc["STATION_001", "days"] == 2
        assert result.loc["STATION_001", "eovs"] == ["oxygen", "subSurfaceTemperature"]
        assert result.loc["STATION_002", "eovs"] == ["subSurfaceTemperature"]

    def test_eov_variables_are_counted_in_the_day_query(self, dataset):
        get_profiles(dataset)
        request_vars = _counting_queries(dataset)[0].split("%26")[0].split(",")
        assert {"temperature", "oxygen", "depth"} <= set(request_vars)

    def test_failed_day_count_falls_back_to_get_count(self, two_station_dataset):
        two_station_dataset.dataset_tabledap_query.side_effect = (
            lambda url: pd.DataFrame()
        )
        result = get_profiles(two_station_dataset)
        two_station_dataset.get_count.assert_called()
        assert len(result) == 2

    def test_gateway_timeout_defers_instead_of_rescanning(self, two_station_dataset):
        """After a 504 the plain count would time out too; the harvester's
        deferred retry redoes the dataset once ERDDAP has cached the result."""
        two_station_dataset.dataset_tabledap_query.side_effect = (
            lambda url: pd.DataFrame()
        )
        two_station_dataset.erddap_server.gateway_timeouts = {DATASET_ID: 0.0}
        result = get_profiles(two_station_dataset)
        assert result.empty
        two_station_dataset.get_count.assert_not_called()


class TestTimeCoverageResolution:
    """time_coverage_resolution holds for every feature: records come from each
    feature's span, and no counting request is made."""

    @pytest.fixture
    def dataset(self, two_station_dataset):
        two_station_dataset.globals["time_coverage_resolution"] = "PT1H"
        return two_station_dataset

    def test_no_counting_request(self, dataset):
        get_profiles(dataset)
        dataset.get_count.assert_not_called()
        assert _counting_queries(dataset) == []

    def test_n_records_is_the_span_over_the_resolution(self, dataset):
        result = get_profiles(dataset).set_index("timeseries_id")
        hours = (pd.Timestamp("2023-12-31") - pd.Timestamp("2020-01-01")).days * 24
        assert result.loc["STATION_001", "n_records"] == hours + 1

    def test_every_feature_gets_the_dataset_eovs_and_its_span(self, dataset):
        result = get_profiles(dataset)
        for eovs in result["eovs"]:
            assert eovs == dataset.eovs
        span = (pd.Timestamp("2023-12-31") - pd.Timestamp("2020-01-01")).days
        assert result["days"].tolist() == [span, span]
        assert result["day_ranges"].tolist() == [[], []]

    @pytest.mark.parametrize("resolution", ["monthly", "PT0S", ""])
    def test_unusable_resolution_is_ignored(self, two_station_dataset, resolution):
        two_station_dataset.globals["time_coverage_resolution"] = resolution
        get_profiles(two_station_dataset)
        two_station_dataset.get_count.assert_called()

    def test_profile_type_ignores_the_resolution(self):
        """A Profile feature is one cast; span / resolution says nothing about
        its record count."""
        dataset = build_mock_dataset(cdm_data_type="Profile")
        dataset.globals["time_coverage_resolution"] = "PT1H"
        get_profiles(dataset)
        dataset.get_count.assert_called()


class TestSingleTimeseriesFromMetadata:
    """A single time series whose metadata has time coverage, position and
    resolution needs no data scan beyond enumerating it."""

    @pytest.fixture
    def dataset(self, single_station_dataset):
        single_station_dataset.globals.update({
            "time_coverage_resolution": "PT1H",
            "geospatial_lat_min": "48.5",
            "geospatial_lat_max": "48.5",
            "geospatial_lon_min": "-125.0",
            "geospatial_lon_max": "-125.0",
        })
        return single_station_dataset

    def test_no_data_query(self, dataset):
        result = get_profiles(dataset)
        assert len(result) == 1
        dataset.get_max_min.assert_not_called()
        dataset.get_count.assert_not_called()
        dataset.dataset_tabledap_query.assert_not_called()

    def test_time_coverage_globals_stand_in_for_actual_range(self, dataset):
        dataset.df_variables.loc["time", "actual_range"] = ""
        dataset.globals["time_coverage_start"] = "2021-02-01T00:00:00Z"
        dataset.globals["time_coverage_end"] = "2021-02-02T00:00:00Z"
        result = get_profiles(dataset)
        assert result.loc[0, "time_min"] == pd.Timestamp("2021-02-01", tz="UTC")
        assert result.loc[0, "n_records"] == 25
        dataset.get_max_min.assert_not_called()


class TestIdentityCarriesBounds:
    def test_time_bounds_from_the_identity_are_not_requeried(self, two_station_dataset):
        two_station_dataset.get_profile_ids.return_value = pd.DataFrame({
            "station_id": STATIONS,
            "time_min": ["2020-01-01T00:00:00Z", "2021-01-01T00:00:00Z"],
            "time_max": ["2020-12-31T00:00:00Z", "2021-12-31T00:00:00Z"],
        })
        result = get_profiles(two_station_dataset).set_index("timeseries_id")
        queried = [c.args[0][-1] for c in two_station_dataset.get_max_min.call_args_list]
        assert "time" not in queried
        assert result.loc["STATION_002", "time_min"] == pd.Timestamp("2021-01-01", tz="UTC")

    def test_subset_positions_give_the_box_without_a_query(self, two_station_dataset):
        """STATION_002 was relocated once: its box spans both positions."""
        two_station_dataset.get_profile_ids.return_value = pd.DataFrame({
            "station_id": ["STATION_001", "STATION_002", "STATION_002"],
            "latitude": [48.5, 49.5, 49.7],
            "longitude": [-125.0, -126.0, -126.2],
        })
        result = get_profiles(two_station_dataset).set_index("timeseries_id")
        queried = [c.args[0][-1] for c in two_station_dataset.get_max_min.call_args_list]
        assert "latitude" not in queried and "longitude" not in queried
        assert len(result) == 2
        assert result.loc["STATION_002", "latitude_min"] == 49.5
        assert result.loc["STATION_002", "latitude_max"] == 49.7


class TestTimeSeriesProfile:
    @pytest.fixture
    def dataset(self, monkeypatch):
        monkeypatch.setattr(timeseries_profile, "MAX_PROFILES_PER_TIMESERIES", 1)
        dataset = build_mock_dataset(cdm_data_type="TimeSeriesProfile")
        dataset.profile_variables = {"timeseries_id": "station_id", "profile_id": "cast"}
        dataset.profile_variable_list = ["cast", "station_id"]
        identity = pd.DataFrame({
            "cast": ["c1", "c2", "c3"],
            "station_id": ["STATION_001", "STATION_001", "STATION_002"],
            "time_min": ["2020-01-01T00:00:00Z", "2020-06-01T00:00:00Z",
                         "2021-01-01T00:00:00Z"],
            "time_max": ["2020-01-01T00:00:00Z", "2020-06-01T00:00:00Z",
                         "2021-01-01T00:00:00Z"],
        })
        dataset.get_profile_ids.return_value = identity
        dataset.profile_ids = identity
        dataset.get_max_min.side_effect = _stations_max_min(STATIONS)
        return dataset

    def test_collapse_keeps_each_timeseries_envelope(self, dataset):
        result = get_profiles(dataset).set_index("timeseries_id")
        assert result.loc["STATION_001", "time_min"] == pd.Timestamp("2020-01-01", tz="UTC")
        assert result.loc["STATION_001", "time_max"] == pd.Timestamp("2020-06-01", tz="UTC")
        assert result.loc["STATION_001", "n_profiles"] == 2

    def test_few_profiles_per_timeseries_keep_one_feature_per_profile(
        self, dataset, monkeypatch
    ):
        monkeypatch.setattr(timeseries_profile, "MAX_PROFILES_PER_TIMESERIES", 2)
        per_station = dataset.get_max_min.side_effect

        def per_cast(vars_list):
            bounds = per_station(["station_id", vars_list[-1]]).reset_index()
            return (
                dataset.profile_ids[["cast", "station_id"]]
                .merge(bounds, on="station_id")
                .set_index(vars_list[:-1])
            )

        dataset.get_max_min.side_effect = per_cast
        dataset.get_count.return_value = dataset.profile_ids[
            ["cast", "station_id"]
        ].assign(time=10)
        result = get_profiles(dataset)
        assert sorted(result["profile_id"]) == ["c1", "c2", "c3"]
        assert (result["n_profiles"] == 1).all()

    def test_resolution_counts_rows_per_profile_from_one_sample(self, dataset):
        dataset.globals["time_coverage_resolution"] = "P1D"
        dataset.dataset_tabledap_query.side_effect = lambda url: pd.DataFrame({
            "station_id": ["STATION_001"] * 3,
            "time": ["2020-01-01T00:00:00Z"] * 3,
        })
        result = get_profiles(dataset).set_index("timeseries_id")

        (url,) = [c.args[0] for c in dataset.dataset_tabledap_query.call_args_list]
        assert url == "station_id,time&time=2020-01-01T00:00:00Z"
        days = (pd.Timestamp("2020-06-01") - pd.Timestamp("2020-01-01")).days
        assert result.loc["STATION_001", "n_records"] == (days + 1) * 3
        # absent from the sample: the mean of the stations that were there
        assert result.loc["STATION_002", "n_records"] == 3
        dataset.get_count.assert_not_called()

    def test_failed_sample_counts_one_row_per_timestep(self, dataset):
        dataset.globals["time_coverage_resolution"] = "P1D"
        dataset.dataset_tabledap_query.side_effect = lambda url: pd.DataFrame()
        result = get_profiles(dataset).set_index("timeseries_id")
        days = (pd.Timestamp("2020-06-01") - pd.Timestamp("2020-01-01")).days
        assert result.loc["STATION_001", "n_records"] == days + 1
