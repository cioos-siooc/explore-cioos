"""Unit tests for trajectory coverage-cell extraction (dataset_types.trajectory_features)."""

import logging
from unittest.mock import MagicMock
from urllib.parse import unquote

import pandas as pd
import pytest
from requests.exceptions import HTTPError

from cde_harvester.dataset_types import extract_features, get_handler
from cde_harvester.dataset_types.trajectory_features import (
    GRID_DEG,
    MAX_TRACK_POINTS_CAP,
    MIN_TRACK_POINTS_CAP,
    TRACK_DAY_SECONDS,
    TRACK_MAX_INTERVAL_SECONDS,
    TRACK_MIN_INTERVAL_SECONDS,
    _cap_for_active_days,
    _choose_track_interval_seconds,
    _decimate_tracks,
    _iter_raw_chunks,
    extract_cells,
    extract_track_points,
)
from cde_harvester.loading.loader import (
    prepare_trajectory_cells_dataframe,
    prepare_trajectory_points_dataframe,
)

ERDDAP_URL = "https://test.erddap.com/erddap"
DATASET_ID = "test_trajectory_001"

# Two occupied cells on the canonical 1/12-degree grid
CELL_A = (round(576 * GRID_DEG, 8), round(-1500 * GRID_DEG, 8))   # 48.0, -125.0
CELL_B = (round(577 * GRID_DEG, 8), round(-1500 * GRID_DEG, 8))


def _minmax_time_df():
    """orderByMinMax response: 2 rows (min,max) per (trajectory, cell)."""
    return pd.DataFrame({
        "traj_id": ["m1"] * 4,
        "latitude": [CELL_A[0], CELL_A[0], CELL_B[0], CELL_B[0]],
        "longitude": [CELL_A[1], CELL_A[1], CELL_B[1], CELL_B[1]],
        "time": [
            "2021-01-01T00:00:00Z", "2021-01-10T00:00:00Z",
            "2021-01-10T00:00:00Z", "2021-01-20T00:00:00Z",
        ],
    })


def _minmax_depth_df():
    return pd.DataFrame({
        "traj_id": ["m1"] * 4,
        "latitude": [CELL_A[0], CELL_A[0], CELL_B[0], CELL_B[0]],
        "longitude": [CELL_A[1], CELL_A[1], CELL_B[1], CELL_B[1]],
        "depth": [0.0, 100.0, 5.0, 80.0],
    })


def _count_df():
    return pd.DataFrame({
        "traj_id": ["m1", "m1"],
        "latitude": [CELL_A[0], CELL_B[0]],
        "longitude": [CELL_A[1], CELL_B[1]],
        "time": [500, 300],
    })


def _profiles_distinct_df():
    """distinct() over (traj, profile, lat, lon): 2 profiles in A, 1 in B."""
    return pd.DataFrame({
        "traj_id": ["m1", "m1", "m1"],
        "prof_id": ["p1", "p2", "p3"],
        "latitude": [CELL_A[0], CELL_A[0], CELL_B[0]],
        "longitude": [CELL_A[1], CELL_A[1], CELL_B[1]],
    })


def _per_profile_track_df():
    """orderByMin("traj,prof,time"): one raw (unsnapped) fix per profile."""
    return pd.DataFrame({
        "traj_id": ["m1", "m1", "m1"],
        "prof_id": ["p1", "p2", "p3"],
        "time": [
            "2021-01-01T06:00:00Z", "2021-01-11T06:00:00Z", "2021-01-19T06:00:00Z",
        ],
        "latitude": [48.0132, 48.0451, 48.0972],
        "longitude": [-125.0021, -125.0388, -125.0779],
    })


def _per_day_track_df():
    """orderByMin("traj,time/1day"): first fix of each day (raw coords)."""
    return pd.DataFrame({
        "traj_id": ["m1", "m1", "m1"],
        "time": [
            "2021-01-01T00:30:00Z", "2021-01-02T00:15:00Z", "2021-01-03T01:00:00Z",
        ],
        "latitude": [48.0132, 48.0451, 48.0972],
        "longitude": [-125.0021, -125.0388, -125.0779],
    })


def build_trajectory_dataset(cdm_data_type="Trajectory", with_depth=True,
                             fail_server_binning=False):
    dataset = MagicMock()
    dataset.id = DATASET_ID
    dataset.erddap_url = ERDDAP_URL
    dataset.cdm_data_type = cdm_data_type
    dataset.logger = logging.getLogger("test")
    dataset.globals = {
        "time_coverage_start": "2021-01-01T00:00:00Z",
        "time_coverage_end": "2021-01-20T00:00:00Z",
    }
    dataset.variables_list = ["traj_id", "prof_id", "latitude", "longitude", "time"] + (
        ["depth"] if with_depth else []
    )
    rows = [
        {"name": "traj_id", "cf_role": "trajectory_id"},
    ]
    if cdm_data_type == "TrajectoryProfile":
        rows.append({"name": "prof_id", "cf_role": "profile_id"})
    dataset.df_variables = pd.DataFrame(rows)

    def fake_query(url):
        plain = unquote(url)
        if "orderByMinMax" in plain:
            if fail_server_binning:
                raise HTTPError("500: No operator found in constraint")
            if ",time" in plain.split("orderByMinMax")[1]:
                return _minmax_time_df()
            return _minmax_depth_df()
        if "orderByMin(" in plain:
            if fail_server_binning:
                raise HTTPError("500: No operator found in constraint")
            if "prof_id" in plain:
                return _per_profile_track_df()
            return _per_day_track_df()
        if "orderByCount" in plain:
            return _count_df()
        if plain.startswith("traj_id&distinct"):
            return pd.DataFrame({"traj_id": ["m1"]})
        if "distinct()" in plain and "prof_id" in plain:
            return _profiles_distinct_df()
        # fallback full-column download (chunked)
        if plain.startswith("traj_id,latitude,longitude,time"):
            n = 6
            return pd.DataFrame({
                "traj_id": ["m1"] * n,
                "latitude": [CELL_A[0] + 0.001] * 3 + [CELL_B[0] - 0.001] * 3,
                "longitude": [CELL_A[1]] * n,
                "time": ["2021-01-0%dT00:00:00Z" % (i + 1) for i in range(n)],
                "depth": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            })
        raise AssertionError(f"Unexpected query: {plain}")

    dataset.dataset_tabledap_query = MagicMock(side_effect=fake_query)
    return dataset


class TestServerBinnedExtraction:
    def test_two_cells_extracted(self):
        cells = extract_cells(build_trajectory_dataset())
        assert len(cells) == 2
        assert set(cells["trajectory_id"]) == {"m1"}
        assert set(cells["dataset_id"]) == {DATASET_ID}
        assert set(cells["erddap_url"]) == {ERDDAP_URL}

    def test_counts_and_extents(self):
        cells = extract_cells(build_trajectory_dataset()).sort_values("n_records", ascending=False)
        assert cells["n_records"].tolist() == [500, 300]
        a = cells.iloc[0]
        assert a["depth_min"] == 0.0 and a["depth_max"] == 100.0
        assert a["days"] == 10  # Jan 1 -> Jan 10 (9 days) + same-day floor applies to 0 only
        assert a["records_per_day"] == pytest.approx(500 / 9)

    def test_dataset_attributes_populated(self):
        dataset = build_trajectory_dataset()
        extract_cells(dataset)
        assert dataset.trajectory_id_variable == "traj_id"
        assert len(dataset.profile_ids) == 1  # one mission -> datasets.n_profiles

    def test_dispatch_via_registry(self):
        dataset = build_trajectory_dataset()
        cells = extract_features(dataset)
        assert len(cells) == 2
        assert get_handler("Trajectory").feature_kind == "trajectory_cells"

    def test_no_depth_variable_fills_zero(self):
        cells = extract_cells(build_trajectory_dataset(with_depth=False))
        assert (cells["depth_min"] == 0).all()
        assert (cells["depth_max"] == 0).all()


class TestTrajectoryProfile:
    def test_profiles_per_cell(self):
        dataset = build_trajectory_dataset(cdm_data_type="TrajectoryProfile")
        cells = extract_cells(dataset, count_profiles=True).sort_values(
            "n_records", ascending=False
        )
        assert cells["n_profiles"].tolist() == [2, 1]

    def test_plain_trajectory_has_zero_profiles(self):
        cells = extract_cells(build_trajectory_dataset())
        assert (cells["n_profiles"] == 0).all()


class TestFallback:
    def test_falls_back_to_chunked_download(self):
        dataset = build_trajectory_dataset(fail_server_binning=True)
        cells = extract_cells(dataset)
        # 6 raw fixes binned into the two cells
        assert len(cells) == 2
        assert cells["n_records"].sum() == 6

    def test_chunks_by_month_not_year(self):
        # A high-frequency trajectory's full download can itself exceed
        # MAX_RESPONSE_SIZE within a single year-wide window (seen in
        # practice); monthly chunking bounds that far more reliably. Jan 1 ->
        # Mar 15 spans parts of 3 calendar months -> 3 chunk queries, not the
        # single query the old yearly chunking would have issued.
        dataset = MagicMock()
        dataset.logger = logging.getLogger("test")
        dataset.globals = {
            "time_coverage_start": "2021-01-01T00:00:00Z",
            "time_coverage_end": "2021-03-15T00:00:00Z",
        }
        queries = []
        dataset.dataset_tabledap_query = MagicMock(
            side_effect=lambda url: (queries.append(url), pd.DataFrame())[1]
        )

        list(_iter_raw_chunks(dataset, "traj_id", has_depth=False))

        assert len(queries) == 3


class TestPrepareTrajectoryCellsDataframe:
    def test_dedup_on_unique_key(self):
        df = pd.DataFrame({
            "erddap_url": [ERDDAP_URL] * 2,
            "dataset_id": [DATASET_ID] * 2,
            "trajectory_id": ["m1", "m1"],
            # float artifacts that must collapse to one cell after rounding
            "latitude": [48.000000004, 48.000000001],
            "longitude": [-125.0, -125.0],
            "time_min": ["2021-01-01", "2021-01-02"],
            "time_max": ["2021-01-05", "2021-01-09"],
            "depth_min": [0.0, 5.0],
            "depth_max": [50.0, 100.0],
            "n_records": [10, 20],
            "n_profiles": [1, 2],
            "records_per_day": [2.0, 4.0],
            "days": [5, 8],
        })
        out = prepare_trajectory_cells_dataframe(df)
        assert len(out) == 1
        row = out.iloc[0]
        assert row["n_records"] == 30
        assert row["n_profiles"] == 3
        assert row["depth_max"] == 100.0
        assert row["time_max"] == "2021-01-09"

    def test_bigint_columns_come_out_int64(self):
        # regression: the orderByCount merge/fillna upcasts n_records to
        # float64, and Postgres COPY rejects "2.0" for a bigint column
        df = pd.DataFrame({
            "erddap_url": [ERDDAP_URL] * 2,
            "dataset_id": [DATASET_ID] * 2,
            "trajectory_id": ["m1", "m2"],
            "latitude": [48.0, 49.0],
            "longitude": [-125.0, -126.0],
            "time_min": ["2021-01-01", "2021-02-01"],
            "time_max": ["2021-01-05", "2021-02-05"],
            "depth_min": [0.0, 0.0],
            "depth_max": [50.0, 60.0],
            "n_records": [2.0, float("nan")],
            "n_profiles": [1.0, float("nan")],
            "records_per_day": [2.0, 4.0],
            "days": [5.0, float("nan")],
        })
        out = prepare_trajectory_cells_dataframe(df)
        for col in ("n_records", "n_profiles", "days"):
            assert out[col].dtype == "Int64", col
        assert out.loc[out["trajectory_id"] == "m1", "n_records"].iloc[0] == 2

    def test_null_trajectory_id_becomes_empty_string(self):
        df = pd.DataFrame({
            "erddap_url": [ERDDAP_URL],
            "dataset_id": [DATASET_ID],
            "trajectory_id": [None],
            "latitude": [48.0],
            "longitude": [-125.0],
            "time_min": ["2021-01-01"],
            "time_max": ["2021-01-05"],
            "depth_min": [0.0],
            "depth_max": [50.0],
            "n_records": [10],
            "n_profiles": [0],
            "records_per_day": [2.0],
            "days": [5],
        })
        out = prepare_trajectory_cells_dataframe(df)
        assert out.iloc[0]["trajectory_id"] == ""


def _dataset_for_tracks(cdm_data_type="Trajectory", fail_server_binning=False):
    """Trajectory dataset with the CF-role attrs extract_cells would have set."""
    dataset = build_trajectory_dataset(
        cdm_data_type=cdm_data_type, fail_server_binning=fail_server_binning
    )
    dataset.trajectory_id_variable = "traj_id"
    dataset.profile_id_variable = (
        "prof_id" if cdm_data_type == "TrajectoryProfile" else None
    )
    return dataset


class TestTrackPointExtraction:
    def test_per_profile_fixes(self):
        ds = _dataset_for_tracks("TrajectoryProfile")
        points = extract_track_points(ds, per_profile=True)
        assert len(points) == 3
        assert points["profile_id"].tolist() == ["p1", "p2", "p3"]
        # raw coordinates, NOT snapped to the cell grid
        assert points["latitude"].tolist() == [48.0132, 48.0451, 48.0972]
        # ordered by time
        assert points["time"].is_monotonic_increasing
        assert set(points["dataset_id"]) == {DATASET_ID}
        assert set(points["erddap_url"]) == {ERDDAP_URL}
        # the request grouped on (traj, profile) with min time
        urls = [unquote(c.args[0]) for c in ds.dataset_tabledap_query.call_args_list]
        assert any('orderByMin("traj_id,prof_id,time")' in u for u in urls)

    def test_per_day_fixes(self):
        ds = _dataset_for_tracks("Trajectory")
        points = extract_track_points(ds, per_profile=False)
        assert len(points) == 3
        assert points["profile_id"].isna().all()
        assert points["time"].is_monotonic_increasing
        urls = [unquote(c.args[0]) for c in ds.dataset_tabledap_query.call_args_list]
        # Day-level probe, then a finer refine query sized from the probe's
        # own row count (3 active days -> clamp(3*86400/4000, 60, 86400)=65s).
        assert any('orderByMin("traj_id,time/86400,time")' in u for u in urls)
        assert any('orderByMin("traj_id,time/65,time")' in u for u in urls)

    def test_fallback_downsamples_per_day(self):
        # orderByMin raises -> monthly-chunk raw download, reduced locally.
        # The raw fixture has 6 fixes on 6 distinct days -> 6 track points.
        points = extract_track_points(
            _dataset_for_tracks("Trajectory", fail_server_binning=True),
            per_profile=False,
        )
        assert len(points) == 6
        assert points["time"].is_monotonic_increasing

    def test_schema_validates(self):
        from cde_harvester.core.schemas import TrajectoryPointSchema

        points = extract_track_points(
            _dataset_for_tracks("TrajectoryProfile"), per_profile=True
        )
        TrajectoryPointSchema.validate(points)


class TestDecimateTracks:
    def test_under_cap_untouched(self):
        df = pd.DataFrame({
            "trajectory_id": ["m1"] * 10,
            "time": pd.date_range("2021-01-01", periods=10, freq="D"),
        })
        assert len(_decimate_tracks(df, max_points=10)) == 10

    def test_over_cap_keeps_first_last_and_stride(self):
        # A zigzag with a steady longitude trend (baseline chord ~horizontal)
        # and a latitude swing well beyond the DP tolerance on every step, so
        # Douglas-Peucker alone can't reduce it below the cap and the even
        # stride actually has to run.
        n = 100
        df = pd.DataFrame({
            "trajectory_id": ["m1"] * n,
            "time": pd.date_range("2021-01-01", periods=n, freq="D"),
            "latitude": 48.0 + 0.02 * (pd.Series(range(n)) % 2),
            "longitude": -125.0 + 0.01 * pd.Series(range(n)),
        })
        out = _decimate_tracks(df, max_points=10)
        assert len(out) <= 11  # stride keeps ceil(100/10)=10th rows + last
        assert out["time"].iloc[0] == df["time"].iloc[0]
        assert out["time"].iloc[-1] == df["time"].iloc[-1]

    def test_cap_is_per_trajectory(self):
        n = 100
        df = pd.concat([
            pd.DataFrame({
                "trajectory_id": ["m1"] * n,
                "time": pd.date_range("2021-01-01", periods=n, freq="D"),
                "latitude": 48.0 + 0.02 * (pd.Series(range(n)) % 2),
                "longitude": -125.0 + 0.01 * pd.Series(range(n)),
            }),
            pd.DataFrame({
                "trajectory_id": ["m2"] * 5,
                "time": pd.date_range("2021-01-01", periods=5, freq="D"),
            }),
        ])
        out = _decimate_tracks(df, max_points=10)
        assert len(out[out["trajectory_id"] == "m2"]) == 5

    def test_shape_preserving_cap_keeps_corner(self):
        # An "L"-shaped route: 20 fixes east, then 20 fixes north. Douglas-
        # Peucker should represent this exactly with its 3 defining vertices
        # (start, corner, end) -- an even stride at the same cap would land on
        # arbitrary fixes and likely miss the corner, cutting the turn short.
        leg = 20
        lon1 = -125.0 + 0.01 * pd.Series(range(leg))
        lat1 = pd.Series([48.0] * leg)
        corner_lon = lon1.iloc[-1]
        lon2 = pd.Series([corner_lon] * leg)
        lat2 = 48.0 + 0.01 * pd.Series(range(1, leg + 1))
        n = leg * 2
        df = pd.DataFrame({
            "trajectory_id": ["m1"] * n,
            "time": pd.date_range("2021-01-01", periods=n, freq="D"),
            "latitude": pd.concat([lat1, lat2], ignore_index=True),
            "longitude": pd.concat([lon1, lon2], ignore_index=True),
        })
        out = _decimate_tracks(df, max_points=5)
        assert len(out) == 3
        assert any(abs(out["longitude"] - corner_lon) < 1e-9)


class TestChooseTrackIntervalSeconds:
    def test_typical_cadence_scales_between_floor_and_ceiling(self):
        # 450 active days (the ferry case from the live findings report) ->
        # clamp(450*86400/4000, 60, 86400) = 9720s, well inside both bounds.
        assert _choose_track_interval_seconds(450) == 9720
        assert _choose_track_interval_seconds(450) < TRACK_DAY_SECONDS

    def test_floors_at_minimum_for_very_few_active_days(self):
        assert _choose_track_interval_seconds(1) == TRACK_MIN_INTERVAL_SECONDS

    def test_ceilings_at_one_day_for_very_long_low_activity_deployments(self):
        # A very long-running, near-daily reporter never gets coarser than the
        # old fixed "1 day" behavior -- no regression there.
        assert _choose_track_interval_seconds(100_000) == TRACK_MAX_INTERVAL_SECONDS

    def test_zero_active_days_stays_at_day_level(self):
        assert _choose_track_interval_seconds(0) == TRACK_MAX_INTERVAL_SECONDS

    def test_immune_to_a_single_outlier_active_day(self):
        """A single corrupt-timestamp fix that lands on a day far outside the
        real deployment window only adds one active day to the count -- unlike
        a max(time)-min(time) duration, which that same outlier would blow up
        to years (seen in practice on a live C-PROOF glider dataset, where one
        fix landed 25 years before an otherwise ~2-week deployment)."""
        real_deployment_active_days = 14
        with_one_outlier_day = real_deployment_active_days + 1

        interval_without_outlier = _choose_track_interval_seconds(real_deployment_active_days)
        interval_with_outlier = _choose_track_interval_seconds(with_one_outlier_day)

        # One extra active day nudges the interval by at most a day's worth of
        # bucket-width -- nowhere near TRACK_MAX_INTERVAL_SECONDS, which is
        # what a naive multi-year duration would have forced regardless of
        # the platform's true reporting cadence.
        assert abs(interval_with_outlier - interval_without_outlier) <= TRACK_DAY_SECONDS
        assert interval_with_outlier < TRACK_MAX_INTERVAL_SECONDS


class TestCapForActiveDays:
    def test_floors_at_minimum_for_short_deployments(self):
        assert _cap_for_active_days(1) == MIN_TRACK_POINTS_CAP

    def test_scales_linearly_in_the_middle(self):
        # 44 active days (the misclassified-glider deployment from the live
        # findings report) -> 44*50 = 2200, comfortably inside both bounds.
        assert _cap_for_active_days(44) == 2200

    def test_ceilings_at_maximum_for_long_deployments(self):
        assert _cap_for_active_days(1000) == MAX_TRACK_POINTS_CAP


class TestPrepareTrajectoryPointsDataframe:
    def test_dedupe_and_drop_unusable(self):
        df = pd.DataFrame({
            "erddap_url": [ERDDAP_URL] * 4,
            "dataset_id": [DATASET_ID] * 4,
            "trajectory_id": ["m1", "m1", "m1", None],
            "profile_id": ["p1", "p1-dup", None, "p9"],
            "time": [
                "2021-01-01T00:00:00Z",
                "2021-01-01T00:00:00Z",   # duplicate key -> dropped
                "not-a-date",             # unparseable -> dropped
                "2021-01-02T00:00:00Z",
            ],
            "latitude": [48.0, 48.1, 48.2, 48.3],
            "longitude": [-125.0, -125.1, -125.2, -125.3],
        })
        out = prepare_trajectory_points_dataframe(df)
        assert len(out) == 2
        # first-wins on the duplicate timestamp
        m1 = out[out["trajectory_id"] == "m1"]
        assert m1["profile_id"].tolist() == ["p1"]
        # null trajectory_id normalized to ''
        assert (out["trajectory_id"] == "").sum() == 1

    def test_empty_profile_id_becomes_null(self):
        df = pd.DataFrame({
            "erddap_url": [ERDDAP_URL],
            "dataset_id": [DATASET_ID],
            "trajectory_id": ["m1"],
            "profile_id": [""],
            "time": ["2021-01-01T00:00:00Z"],
            "latitude": [48.0],
            "longitude": [-125.0],
        })
        out = prepare_trajectory_points_dataframe(df)
        assert out["profile_id"].isna().all()
