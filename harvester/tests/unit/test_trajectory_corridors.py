"""Unit tests for the coverage-corridor pipeline pieces:

- dataset_types.trajectory_points  (orderByClosest decimation + gap segmentation)
- dataset_types.trajectory_footprints (time-sliced corridor skeletons)
- loading.loader.prepare_trajectory_footprints_dataframe (COPY hygiene)
- staging-table drift guard against 5_profile_process.sql
"""

import logging
import re
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import unquote

import pandas as pd
import pytest
from requests.exceptions import HTTPError

from cde_harvester.core.schemas import TrajectoryFootprintSchema
from cde_harvester.dataset_types import trajectory_footprints, trajectory_points
from cde_harvester.dataset_types.trajectory_points import (
    compute_interval,
    extract_points,
    segment_points,
    snap_interval,
)
from cde_harvester.loading.loader import prepare_trajectory_footprints_dataframe

ERDDAP_URL = "https://test.erddap.com/erddap"
DATASET_ID = "test_trajectory_001"


def _points(rows):
    df = pd.DataFrame(rows)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    if "depth" not in df:
        df["depth"] = 1.0
    return df


class TestIntervalLadder:
    def test_snaps_up_to_next_rung(self):
        assert snap_interval(61) == ("5minutes", 300)
        assert snap_interval(300) == ("5minutes", 300)
        assert snap_interval(86401) == ("3days", 259200)

    def test_clamps_to_top_of_ladder(self):
        assert snap_interval(10**9) == ("30days", 2592000)

    def test_compute_interval_sums_per_trajectory_spans(self, monkeypatch):
        monkeypatch.setenv("TRAJ_TARGET_POINTS", "100")
        cells = pd.DataFrame({
            "trajectory_id": ["m1", "m1", "m2"],
            "time_min": pd.to_datetime(
                ["2021-01-01", "2021-01-05", "2021-02-01"], utc=True
            ),
            "time_max": pd.to_datetime(
                ["2021-01-03", "2021-01-11", "2021-02-11"], utc=True
            ),
        })
        # spans: m1 = 10 days, m2 = 10 days -> 20 days / 100 pts = 4.8h -> 6hours
        assert compute_interval(cells) == ("6hours", 21600)


class TestSegmentation:
    def test_time_gap_splits(self):
        df = _points([
            {"trajectory_id": "m1", "time": "2021-01-01T00:00Z", "latitude": 48.0, "longitude": -125.0},
            {"trajectory_id": "m1", "time": "2021-01-01T01:00Z", "latitude": 48.01, "longitude": -125.0},
            # 3-day hole > max(4x1h, 12h)
            {"trajectory_id": "m1", "time": "2021-01-04T01:00Z", "latitude": 48.02, "longitude": -125.0},
        ])
        out = segment_points(df, interval_seconds=3600)
        assert out["segment_id"].tolist() == [0, 0, 1]

    def test_distance_jump_splits(self):
        df = _points([
            {"trajectory_id": "m1", "time": "2021-01-01T00:00Z", "latitude": 48.0, "longitude": -125.0},
            # ~5 degrees latitude in one hour: > 200 km
            {"trajectory_id": "m1", "time": "2021-01-01T01:00Z", "latitude": 53.0, "longitude": -125.0},
        ])
        out = segment_points(df, interval_seconds=3600)
        assert out["segment_id"].tolist() == [0, 1]

    def test_antimeridian_hop_splits(self):
        df = _points([
            {"trajectory_id": "m1", "time": "2021-01-01T00:00Z", "latitude": 52.0, "longitude": 179.9},
            {"trajectory_id": "m1", "time": "2021-01-01T01:00Z", "latitude": 52.0, "longitude": -179.9},
        ])
        out = segment_points(df, interval_seconds=3600)
        assert out["segment_id"].tolist() == [0, 1]

    def test_segment_id_restarts_per_trajectory(self):
        df = _points([
            {"trajectory_id": "m1", "time": "2021-01-01T00:00Z", "latitude": 48.0, "longitude": -125.0},
            {"trajectory_id": "m2", "time": "2021-01-01T00:00Z", "latitude": 49.0, "longitude": -125.0},
            {"trajectory_id": "m2", "time": "2021-01-01T00:30Z", "latitude": 49.01, "longitude": -125.0},
        ])
        out = segment_points(df, interval_seconds=3600)
        assert out.groupby("trajectory_id")["segment_id"].min().tolist() == [0, 0]


def build_points_dataset(responses):
    """Mock dataset whose dataset_tabledap_query pops frames off `responses`
    for each orderByClosest call and records the decoded URLs."""
    dataset = MagicMock()
    dataset.id = DATASET_ID
    dataset.erddap_url = ERDDAP_URL
    dataset.logger = logging.getLogger("test")
    dataset.trajectory_id_variable = "traj_id"
    dataset.variables_list = ["traj_id", "latitude", "longitude", "time", "depth"]
    dataset.queried = []

    def fake_query(url):
        plain = unquote(url)
        assert "orderByClosest" in plain, f"Unexpected query: {plain}"
        dataset.queried.append(plain)
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    dataset.dataset_tabledap_query = MagicMock(side_effect=fake_query)
    return dataset


def _decimated_response(n, start="2021-01-01", freq="1h"):
    times = pd.date_range(start, periods=n, freq=freq, tz="UTC")
    return pd.DataFrame({
        "traj_id": ["m1"] * n,
        "time": times.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latitude": [48.0 + 0.001 * i for i in range(n)],
        "longitude": [-125.0] * n,
        "depth": [1.0] * n,
    })


def _cells_frame(span_days=20):
    return pd.DataFrame({
        "trajectory_id": ["m1"],
        "time_min": pd.to_datetime(["2021-01-01"], utc=True),
        "time_max": pd.to_datetime(["2021-01-01"], utc=True)
        + pd.Timedelta(days=span_days),
        "latitude": [48.0],
        "longitude": [-125.0],
        "depth_min": [0.0],
        "depth_max": [10.0],
    })


class TestExtractPoints:
    def test_single_query_within_budget(self, monkeypatch):
        monkeypatch.setenv("TRAJ_TARGET_POINTS", "100")
        dataset = build_points_dataset([_decimated_response(50)])
        points, interval = extract_points(dataset, _cells_frame())
        assert len(points) == 50
        assert len(dataset.queried) == 1
        # 20 days / 100 points = 4.8h -> snapped to 6hours
        assert 'orderByClosest("traj_id,time/6hours")' in dataset.queried[0]
        assert interval == 21600

    def test_oversize_response_retries_once_coarser(self, monkeypatch):
        monkeypatch.setenv("TRAJ_TARGET_POINTS", "100")
        dataset = build_points_dataset([
            _decimated_response(250),  # > 2x target
            _decimated_response(120),
        ])
        points, interval = extract_points(dataset, _cells_frame())
        assert len(dataset.queried) == 2
        assert 'time/12hours' in dataset.queried[1]  # doubled 6h -> 12h
        assert len(points) == 120
        assert interval == 43200

    def test_http_error_returns_empty(self, monkeypatch):
        monkeypatch.setenv("TRAJ_TARGET_POINTS", "100")
        response = MagicMock(status_code=400)
        dataset = build_points_dataset([HTTPError(response=response)])
        points, _ = extract_points(dataset, _cells_frame())
        assert points.empty

    def test_bad_geom_rows_dropped(self, monkeypatch):
        monkeypatch.setenv("TRAJ_TARGET_POINTS", "100")
        response = _decimated_response(3)
        response.loc[1, "latitude"] = 99.0
        dataset = build_points_dataset([response])
        points, _ = extract_points(dataset, _cells_frame())
        assert len(points) == 2


class TestFootprintsFromPoints:
    def test_slices_at_epoch_aligned_boundaries(self):
        # 40 daily fixes from 2021-01-01 (epoch day 18628, i.e. 28 days into
        # its 30-day window) span three epoch-aligned windows: 2 + 30 + 8 fixes
        df = _points([
            {
                "trajectory_id": "m1",
                "time": t,
                "latitude": 48.0 + i * 0.01,
                "longitude": -125.0,
            }
            for i, t in enumerate(
                pd.date_range("2021-01-01", periods=40, freq="1D", tz="UTC")
            )
        ])
        df["segment_id"] = 0
        out = trajectory_footprints.footprints_from_points(df, days=30, radius_m=5000)
        assert len(out) == 3
        assert (out["segment_id"] == 0).all()
        assert out["track_wkt"].str.startswith("LINESTRING").all()

    def test_bridge_point_joins_consecutive_slices(self):
        df = _points([
            {"trajectory_id": "m1", "time": "2021-01-25T00:00Z", "latitude": 48.0, "longitude": -125.0},
            {"trajectory_id": "m1", "time": "2021-01-26T00:00Z", "latitude": 48.1, "longitude": -125.1},
            # next 30-day window
            {"trajectory_id": "m1", "time": "2021-02-05T00:00Z", "latitude": 48.2, "longitude": -125.2},
        ])
        df["segment_id"] = 0
        out = trajectory_footprints.footprints_from_points(df, days=30, radius_m=5000)
        assert len(out) == 2
        first = out.iloc[0]
        # slice 1 carries slice 2's first fix so buffered corridors overlap
        assert "-125.200000 48.200000" in first["track_wkt"]
        # but its time extents stay its own
        assert first["time_max"] == pd.Timestamp("2021-01-26T00:00Z")

    def test_no_bridge_across_segments(self):
        df = _points([
            {"trajectory_id": "m1", "time": "2021-01-25T00:00Z", "latitude": 48.0, "longitude": -125.0},
            {"trajectory_id": "m1", "time": "2021-01-26T00:00Z", "latitude": 55.0, "longitude": -140.0},
        ])
        df["segment_id"] = [0, 1]
        out = trajectory_footprints.footprints_from_points(df, days=30, radius_m=5000)
        assert len(out) == 2
        assert out.iloc[0]["track_wkt"].startswith("POINT")
        assert "-140" not in out.iloc[0]["track_wkt"]

    def test_single_point_slice_is_point_wkt(self):
        df = _points([
            {"trajectory_id": "m1", "time": "2021-01-25T00:00Z", "latitude": 48.0, "longitude": -125.0},
        ])
        df["segment_id"] = 0
        out = trajectory_footprints.footprints_from_points(df, days=30, radius_m=5000)
        assert out.iloc[0]["track_wkt"] == "POINT(-125.000000 48.000000)"


class TestFootprintsFromCells:
    def test_multipoint_per_trajectory_slice(self):
        cells = pd.DataFrame({
            "trajectory_id": ["m1", "m1", "m1"],
            "latitude": [48.0, 48.1, 49.0],
            "longitude": [-125.0, -125.1, -126.0],
            # Jan 1 + Jan 2 share an epoch-aligned 30-day window; March doesn't
            "time_min": pd.to_datetime(
                ["2021-01-01", "2021-01-02", "2021-03-01"], utc=True
            ),
            "time_max": pd.to_datetime(
                ["2021-01-02", "2021-01-03", "2021-03-02"], utc=True
            ),
            "depth_min": [0.0, 1.0, 2.0],
            "depth_max": [10.0, 20.0, 30.0],
        })
        out = trajectory_footprints.footprints_from_cells(cells, days=30, radius_m=5000)
        assert len(out) == 2  # Jan cells share a slice; March is its own
        jan = out.iloc[0]
        assert jan["track_wkt"].startswith("MULTIPOINT")
        assert jan["track_wkt"].count("(") == 3  # outer + 2 points
        assert jan["depth_max"] == 20.0


class TestBuildFootprints:
    def _dataset(self):
        dataset = MagicMock()
        dataset.id = DATASET_ID
        dataset.erddap_url = ERDDAP_URL
        dataset.logger = logging.getLogger("test")
        return dataset

    def test_points_preferred_and_metadata_stamped(self):
        points = _points([
            {"trajectory_id": "m1", "time": "2021-01-01T00:00Z", "latitude": 48.0, "longitude": -125.0},
            {"trajectory_id": "m1", "time": "2021-01-02T00:00Z", "latitude": 48.1, "longitude": -125.1},
        ])
        points["segment_id"] = 0
        out = trajectory_footprints.build_footprints(
            self._dataset(), _cells_frame(), points
        )
        assert list(out.columns) == trajectory_footprints.FOOTPRINT_COLUMNS
        assert set(out["erddap_url"]) == {ERDDAP_URL}
        assert out.iloc[0]["track_wkt"].startswith("LINESTRING")

    def test_falls_back_to_cells_when_no_points(self):
        out = trajectory_footprints.build_footprints(
            self._dataset(), _cells_frame(), pd.DataFrame()
        )
        assert len(out) == 1
        assert out.iloc[0]["track_wkt"].startswith("MULTIPOINT")

    def test_depth_nulls_fill_zero(self):
        points = _points([
            {"trajectory_id": "m1", "time": "2021-01-01T00:00Z", "latitude": 48.0, "longitude": -125.0},
        ])
        points["segment_id"] = 0
        points["depth"] = float("nan")
        out = trajectory_footprints.build_footprints(
            self._dataset(), _cells_frame(), points
        )
        assert out.iloc[0]["depth_min"] == 0
        assert out.iloc[0]["depth_max"] == 0

    def test_buffer_env_override(self, monkeypatch):
        monkeypatch.setenv("TRAJ_FOOTPRINT_KM", "2.5")
        points = _points([
            {"trajectory_id": "m1", "time": "2021-01-01T00:00Z", "latitude": 48.0, "longitude": -125.0},
        ])
        points["segment_id"] = 0
        out = trajectory_footprints.build_footprints(
            self._dataset(), _cells_frame(), points
        )
        assert out.iloc[0]["buffer_m"] == 2500


class TestPrepareTrajectoryFootprintsDataframe:
    def _frame(self, **overrides):
        base = {
            "erddap_url": [ERDDAP_URL],
            "dataset_id": [DATASET_ID],
            "trajectory_id": ["m1"],
            "segment_id": [1.0],  # float artifact, must COPY as "1"
            "time_min": ["2021-01-01T00:00:00Z"],
            "time_max": ["2021-01-05T00:00:00Z"],
            "depth_min": [0.0],
            "depth_max": [10.0],
            "buffer_m": [5000.0],
            "track_wkt": ["LINESTRING(-125 48,-125.1 48.1)"],
        }
        base.update(overrides)
        return pd.DataFrame(base)

    def test_segment_id_comes_out_int64(self):
        out = prepare_trajectory_footprints_dataframe(self._frame())
        assert out["segment_id"].dtype == "Int64"
        assert out.iloc[0]["segment_id"] == 1

    def test_rows_without_wkt_or_times_dropped(self):
        df = pd.concat([
            self._frame(),
            self._frame(track_wkt=[None]),
            self._frame(time_min=[None]),
        ])
        out = prepare_trajectory_footprints_dataframe(df)
        assert len(out) == 1

    def test_null_trajectory_id_becomes_empty_string(self):
        out = prepare_trajectory_footprints_dataframe(self._frame(trajectory_id=[None]))
        assert out.iloc[0]["trajectory_id"] == ""


class TestStagingTableDrift:
    """TrajectoryFootprintSchema must stay a subset of the staging DDL in
    create_temp_trajectory_footprints() (5_profile_process.sql) — the corridor
    CSV COPYs into that temp table, not into cde.trajectory_footprints."""

    def test_schema_columns_exist_in_staging_ddl(self):
        sql = (
            Path(__file__).resolve().parents[3]
            / "database" / "5_profile_process.sql"
        ).read_text()
        match = re.search(
            r"CREATE TEMP TABLE IF NOT EXISTS temp_trajectory_footprints \((.*?)\n[ \t]*\)",
            sql, re.S,
        )
        assert match, "temp_trajectory_footprints DDL not found"
        ddl_columns = {
            line.strip().split()[0]
            for line in match.group(1).splitlines()
            if line.strip() and not line.strip().startswith("--")
        }
        missing = set(TrajectoryFootprintSchema.to_schema().columns) - ddl_columns
        assert not missing, (
            f"TrajectoryFootprintSchema declares columns missing from the "
            f"temp_trajectory_footprints staging table: {sorted(missing)}"
        )
