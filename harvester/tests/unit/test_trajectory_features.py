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
    _decimate_tracks,
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
        assert any('orderByMin("traj_id,time/1day")' in u for u in urls)

    def test_fallback_downsamples_per_day(self):
        # orderByMin raises -> yearly-chunk raw download, reduced locally.
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
        df = pd.DataFrame({
            "trajectory_id": ["m1"] * 100,
            "time": pd.date_range("2021-01-01", periods=100, freq="D"),
        })
        out = _decimate_tracks(df, max_points=10)
        assert len(out) <= 11  # stride keeps ceil(100/10)=10th rows + last
        assert out["time"].iloc[0] == df["time"].iloc[0]
        assert out["time"].iloc[-1] == df["time"].iloc[-1]

    def test_cap_is_per_trajectory(self):
        df = pd.concat([
            pd.DataFrame({
                "trajectory_id": ["m1"] * 100,
                "time": pd.date_range("2021-01-01", periods=100, freq="D"),
            }),
            pd.DataFrame({
                "trajectory_id": ["m2"] * 5,
                "time": pd.date_range("2021-01-01", periods=5, freq="D"),
            }),
        ])
        out = _decimate_tracks(df, max_points=10)
        assert len(out[out["trajectory_id"] == "m2"]) == 5


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
