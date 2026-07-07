"""Unit tests for trajectory coverage-cell extraction (dataset_types.trajectory_features)."""

import logging
from unittest.mock import MagicMock
from urllib.parse import unquote

import pandas as pd
import pytest
from requests.exceptions import HTTPError

from cde_harvester.dataset_types import extract_features, get_handler
from cde_harvester.dataset_types.trajectory_features import GRID_DEG, extract_cells
from cde_harvester.loading.loader import prepare_trajectory_cells_dataframe

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
