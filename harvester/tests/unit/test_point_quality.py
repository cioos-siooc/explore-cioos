"""Unit tests for the cdm_data_type=Point structural QC.

The sample frames below are shaped from real datasets that declare Point on
the servers this project harvests, measured while designing the checks:

  glider     mun_glider_unit_334_placentia_bay_2022 (smartatlantic)
             912k fixes, ~1 s apart, ~0.2 m of motion between them
  drifter    SPOT-1431_202204 (ceotr) — 30 min apart, metres of drift
  net tows   amundsen12716_Net (amundsen) — 364 records on 47 positions
  casts      uqarBiogeochemistryAlgeaWise (ogsl) — 3+ depths per position
  duplicates ismerCtdAlgaeWise (ogsl) — 75% repeat (time, lat, lon)
  genuine    bio_ctd_public_bio_ctd_stations (ceotr) — 4046 records on
             3629 distinct positions; the one that should be ACCEPTED

Each test names the reason code the ERDDAP admin should receive, because
getting the right diagnosis (not merely a rejection) is the point of the
feature.
"""

import numpy as np
import pandas as pd
import pytest

from cde_harvester.core.errors import (
    POINT_DUPLICATE_RECORDS,
    POINT_MULTI_DEPTH_PER_SITE,
    POINT_QC_INCONCLUSIVE,
    POINT_REPEATED_LOCATIONS,
    POINT_SINGLE_LOCATION,
    POINT_TRAJECTORY_SHAPED,
)
from cde_harvester.dataset_types import point_quality as pq

BASE_TIME = pd.Timestamp("2022-09-20T00:00:00Z")


def _frame(times, lats, lons, depths=None):
    data = {"time": pd.to_datetime(times, utc=True), "latitude": lats, "longitude": lons}
    if depths is not None:
        data["depth"] = depths
    return pd.DataFrame(data).sort_values("time").reset_index(drop=True)


def track(n=800, step_deg=0.000005, seconds=1):
    """A glider: fixes ~0.8 m apart, a second apart, creeping along a line.

    Sized so the whole track covers a few hundred metres — a real sampled
    glider window covered 5.8 km, and a track shorter than
    TRAJECTORY_MIN_PATH_M is correctly not called a trajectory.
    """
    return _frame(
        [BASE_TIME + pd.Timedelta(seconds=seconds * i) for i in range(n)],
        [47.239 + step_deg * i for i in range(n)],
        [-54.177 + step_deg * i for i in range(n)],
        [10 + (i % 50) for i in range(n)],
    )


def scattered(n=300, seed=0):
    """Genuine point samples: independent positions over a region."""
    rng = np.random.default_rng(seed)
    return _frame(
        [BASE_TIME + pd.Timedelta(hours=6 * i) for i in range(n)],
        44 + rng.uniform(0, 4, n),
        -63 + rng.uniform(0, 4, n),
        rng.uniform(0, 3, n),
    )


class TestTrajectoryShaped:
    def test_glider_track_is_rejected_as_a_trajectory(self):
        report = pq._check_trajectory(track(), min_rows=20)
        assert report is not None
        assert report.reason_code == POINT_TRAJECTORY_SHAPED
        # The message has to tell the admin what to declare instead.
        assert "cdm_data_type=Trajectory" in report.details
        assert "cf_role=trajectory_id" in report.details

    def test_drifter_reporting_every_half_hour_is_still_a_trajectory(self):
        """Sampling cadence must not decide this: an hourly drifter is as much
        a track as a 1 Hz glider. An absolute step threshold missed this one."""
        report = pq._check_trajectory(track(seconds=1800), min_rows=20)
        assert report is not None
        assert report.reason_code == POINT_TRAJECTORY_SHAPED

    def test_scattered_samples_are_not_a_trajectory(self):
        assert pq._check_trajectory(scattered(), min_rows=20) is None

    def test_stations_visited_in_sequence_are_not_a_trajectory(self):
        """A research vessel steaming between CTD stations covers a lot of
        ground in time order, and cleared the scale-free ratio on its own —
        3,600 stations over 4,800 km, 26 km between consecutive casts. The
        absolute step cap is what stops it being reported as a glider."""
        n = 300
        report = pq._check_trajectory(
            _frame(
                [BASE_TIME + pd.Timedelta(hours=3 * i) for i in range(n)],
                [40 + 0.25 * i for i in range(n)],
                [-60 + 0.25 * i for i in range(n)],
            ),
            min_rows=20,
        )
        assert report is None

    def test_repeated_position_is_not_a_trajectory(self):
        """Zero motion is not slow motion. Before this was guarded, a stack of
        casts at one position passed as a track because the path length came
        from the jumps BETWEEN stations while the median step was 0."""
        n = 200
        assert (
            pq._check_trajectory(
                _frame(
                    [BASE_TIME + pd.Timedelta(seconds=i) for i in range(n)],
                    [48.5] * n,
                    [-63.2] * n,
                ),
                min_rows=20,
            )
            is None
        )

    def test_too_few_distinct_positions_is_not_judged(self):
        assert pq._check_trajectory(track(n=30), min_rows=20) is None


class TestSingleLocation:
    def test_one_cell_with_many_records_is_a_mooring(self):
        report = pq._check_single_location(total_records=50_000, n_cells=1)
        assert report is not None
        assert report.reason_code == POINT_SINGLE_LOCATION
        assert "cdm_data_type=TimeSeries" in report.details

    def test_several_cells_is_not(self):
        assert pq._check_single_location(total_records=50_000, n_cells=9) is None

    def test_a_handful_of_records_in_one_cell_is_not_conclusive(self):
        assert pq._check_single_location(total_records=3, n_cells=1) is None

    def test_missing_probe_is_not_judged(self):
        assert pq._check_single_location(total_records=None, n_cells=None) is None


class TestMultiDepth:
    def test_casts_at_a_position_are_rejected_as_profiles(self):
        rows = []
        for station in range(10):
            for level in (0, 10, 25, 50):
                rows.append((BASE_TIME + pd.Timedelta(days=station), 45.0 + station, -60.0, level))
        frame = _frame(*zip(*rows))
        report = pq._check_multi_depth(frame, min_rows=20)
        assert report is not None
        assert report.reason_code == POINT_MULTI_DEPTH_PER_SITE
        assert "cdm_data_type=Profile" in report.details
        assert "cf_role=profile_id" in report.details

    def test_one_depth_per_position_is_fine(self):
        assert pq._check_multi_depth(scattered(), min_rows=20) is None

    def test_a_few_centimetres_of_wobble_is_not_a_cast(self):
        """Three depths within instrument noise is not a vertical profile."""
        rows = []
        for station in range(10):
            for level in (0.01, 0.02, 0.03):
                rows.append((BASE_TIME + pd.Timedelta(days=station), 45.0 + station, -60.0, level))
        assert pq._check_multi_depth(_frame(*zip(*rows)), min_rows=20) is None

    def test_dataset_without_depth_is_not_judged(self):
        frame = scattered().drop(columns=["depth"])
        assert pq._check_multi_depth(frame, min_rows=20) is None


class TestRepeatedLocations:
    def test_station_network_is_rejected_as_a_timeseries(self):
        rows = []
        for visit in range(30):
            for station in range(4):
                rows.append(
                    (BASE_TIME + pd.Timedelta(days=visit), 45.0 + station, -60.0 - station)
                )
        report = pq._check_repeated_locations(_frame(*zip(*rows)), min_rows=20)
        assert report is not None
        assert report.reason_code == POINT_REPEATED_LOCATIONS
        assert "cdm_data_type=TimeSeries" in report.details

    def test_independent_positions_are_fine(self):
        assert pq._check_repeated_locations(scattered(), min_rows=20) is None


class TestDuplicates:
    def test_repeated_time_position_depth_is_rejected(self):
        frame = pd.concat([scattered(n=50)] * 4, ignore_index=True)
        report = pq._check_duplicates(frame, min_rows=20)
        assert report is not None
        assert report.reason_code == POINT_DUPLICATE_RECORDS

    def test_a_few_coincident_records_are_tolerated(self):
        frame = scattered(n=100)
        frame = pd.concat([frame, frame.head(5)], ignore_index=True)
        assert pq._check_duplicates(frame, min_rows=20) is None


class TestCheckPointDataset:
    """The orchestration: probe, then run the tests in the order that gives
    the admin the most specific diagnosis."""

    @staticmethod
    def _dataset(monkeypatch, sample, complete=True, total=500, cells=40, days=None):
        dataset = pytest.importorskip("unittest.mock").MagicMock()
        dataset.variables_list = ["time", "latitude", "longitude", "depth"]
        monkeypatch.setattr(pq, "probe_cells", lambda ds: (total, cells))
        monkeypatch.setattr(
            pq, "probe_active_days", lambda ds: days if days is not None else pd.DataFrame()
        )
        monkeypatch.setattr(pq, "probe_sample", lambda ds, **kw: (sample, complete))
        return dataset

    def test_genuine_point_dataset_is_accepted(self, monkeypatch):
        dataset = self._dataset(monkeypatch, scattered())
        assert pq.check_point_dataset(dataset) is None

    def test_a_glider_is_reported_as_a_trajectory_not_as_casts(self, monkeypatch):
        """Order is load-bearing. A glider's fixes round to one position at
        metre precision, so the cast and station tests both fire on one; the
        trajectory test runs first so the admin is told to declare Trajectory
        rather than being sent to add a cf_role=profile_id."""
        dataset = self._dataset(monkeypatch, track())
        report = pq.check_point_dataset(dataset)
        assert report.reason_code == POINT_TRAJECTORY_SHAPED

    def test_total_record_count_is_published_for_the_handler(self, monkeypatch):
        """The handler picks exact rows vs coverage cells from this, so QC has
        to leave it behind rather than make the handler re-query."""
        dataset = self._dataset(monkeypatch, scattered(), total=1234)
        pq.check_point_dataset(dataset)
        assert dataset.point_total_records == 1234

    def test_thin_sample_is_inconclusive_rather_than_accepted(self, monkeypatch):
        """Not enough evidence must not read as a pass: strict QC skips what
        it could not verify."""
        dataset = self._dataset(monkeypatch, scattered(n=3), complete=False)
        report = pq.check_point_dataset(dataset)
        assert report.reason_code == POINT_QC_INCONCLUSIVE

    def test_a_small_complete_dataset_is_judged_on_what_it_has(self, monkeypatch):
        """The same three rows are enough when they ARE the dataset — there is
        no more evidence to wait for."""
        dataset = self._dataset(monkeypatch, scattered(n=8), complete=True)
        assert pq.check_point_dataset(dataset) is None

    def test_no_data_at_all_is_inconclusive(self, monkeypatch):
        dataset = self._dataset(
            monkeypatch, pd.DataFrame(), complete=False, total=None, cells=None
        )
        report = pq.check_point_dataset(dataset)
        assert report.reason_code == POINT_QC_INCONCLUSIVE
