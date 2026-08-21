"""Unit tests for the Point handler's two representations.

A validated Point dataset is stored either as one exact row per sample in
cde.profiles, or — above POINT_EXACT_MAX_SAMPLES — as the coverage cells the
trajectory pipeline already produces. These tests cover the choice between
them and the shape of the exact path, whose synthetic identity is the part
with no precedent elsewhere in the harvester.
"""

import logging
from unittest.mock import MagicMock

import pandas as pd
import pytest

from cde_harvester.core.schemas import ProfileSchema
from cde_harvester.dataset_types.point import (
    POINT_EXACT_MAX_SAMPLES,
    PointHandler,
    extract_exact_samples,
)

# A distinct() response: ERDDAP CSV has a units row that erddap_csv_to_df
# strips, so the frame the handler sees is already values-only.
SAMPLES = pd.DataFrame(
    {
        "time": [
            "2008-01-04T14:49:58Z",
            "2008-01-14T14:12:17Z",
            "2008-02-05T15:20:11Z",
        ],
        "latitude": [44.2667, 44.9333, 45.1000],
        "longitude": [-63.3167, -66.8500, -60.2000],
        "depth": [0.0, 12.5, 3.0],
    }
)


def build_point_dataset(samples=SAMPLES, has_depth=True):
    dataset = MagicMock()
    dataset.id = "test_point_001"
    dataset.erddap_url = "https://example.erddap.ca/erddap"
    dataset.cdm_data_type = "Point"
    dataset.feature_kind = None
    dataset.logger = logging.getLogger("test.point")
    dataset.variables_list = ["time", "latitude", "longitude"] + (
        ["depth"] if has_depth else []
    )
    columns = ["time", "latitude", "longitude"] + (["depth"] if has_depth else [])
    dataset.dataset_tabledap_query.return_value = samples[columns].copy()
    return dataset


class TestExactSamples:
    def test_one_row_per_sample(self):
        profiles = extract_exact_samples(build_point_dataset())
        assert len(profiles) == 3

    def test_conforms_to_the_profiles_schema(self):
        """The exact path writes straight into cde.profiles, so it has to
        satisfy the same schema the shared tabledap pipeline does."""
        ProfileSchema.validate(extract_exact_samples(build_point_dataset()))

    def test_each_sample_is_its_own_point(self):
        """A single sample has no extent: the bounding box collapses onto the
        position, which is what makes it draw as a dot rather than being
        hidden as a region-spanning feature."""
        profiles = extract_exact_samples(build_point_dataset())
        assert (profiles["latitude_min"] == profiles["latitude"]).all()
        assert (profiles["latitude_max"] == profiles["latitude"]).all()
        assert (profiles["longitude_min"] == profiles["longitude"]).all()
        assert (profiles["longitude_max"] == profiles["longitude"]).all()
        assert profiles["show_as_point"].all()

    def test_instant_and_depth_become_the_extent(self):
        profiles = extract_exact_samples(build_point_dataset())
        assert (profiles["time_min"] == profiles["time_max"]).all()
        assert (profiles["depth_min"] == profiles["depth_max"]).all()
        assert profiles["depth_min"].tolist() == [0.0, 12.5, 3.0]

    def test_dataset_without_depth_gets_zero(self):
        profiles = extract_exact_samples(build_point_dataset(has_depth=False))
        assert (profiles["depth_min"] == 0).all()
        assert (profiles["depth_max"] == 0).all()

    def test_records_per_day_is_never_zero(self):
        """The download estimator divides by this."""
        profiles = extract_exact_samples(build_point_dataset())
        assert (profiles["records_per_day"] > 0).all()


class TestSyntheticIdentity:
    """cde.profiles is UNIQUE(erddap_url, dataset_id, timeseries_id,
    profile_id). A Point dataset has no cf_role variable to fill either id
    with, so without a synthetic profile_id every sample in a dataset would
    collide into one row."""

    def test_ids_are_unique_per_sample(self):
        profiles = extract_exact_samples(build_point_dataset())
        assert profiles["profile_id"].is_unique
        assert (profiles["timeseries_id"] == "").all()

    def test_ids_are_deterministic(self):
        """The incremental loader upserts on this key, so an id derived from
        row order would rewrite every row whenever ERDDAP returned the samples
        in a different order."""
        first = extract_exact_samples(build_point_dataset())
        shuffled = SAMPLES.iloc[::-1].reset_index(drop=True)
        second = extract_exact_samples(build_point_dataset(samples=shuffled))
        assert set(first["profile_id"]) == set(second["profile_id"])

    def test_position_and_depth_both_participate(self):
        """Two samples at one instant and position but different depths are
        different samples, and must not collapse."""
        moved = SAMPLES.copy()
        moved.loc[1, ["time", "latitude", "longitude"]] = moved.loc[
            0, ["time", "latitude", "longitude"]
        ].values
        profiles = extract_exact_samples(build_point_dataset(samples=moved))
        assert profiles["profile_id"].is_unique


class TestRepresentationChoice:
    def test_small_dataset_takes_the_exact_path(self):
        dataset = build_point_dataset()
        dataset.point_total_records = 500
        features = PointHandler().extract_features(dataset)
        assert dataset.feature_kind == "profiles"
        assert "show_as_point" in features.columns

    def test_large_dataset_falls_back_to_coverage_cells(self, monkeypatch):
        cells = pd.DataFrame({"latitude": [44.0], "longitude": [-63.0]})
        monkeypatch.setattr(
            "cde_harvester.dataset_types.trajectory_features.extract_cells",
            lambda dataset, count_profiles=False: cells,
        )
        dataset = build_point_dataset()
        dataset.point_total_records = POINT_EXACT_MAX_SAMPLES + 1
        features = PointHandler().extract_features(dataset)
        assert dataset.feature_kind == "trajectory_cells"
        assert features is cells

    def test_unmeasured_count_takes_the_exact_path(self):
        """Falling back to exact rows is the safe default: it is bounded by
        MAX_RESPONSE_SIZE, whereas guessing 'large' would coarsen a small
        dataset to 9 km cells for no reason."""
        dataset = build_point_dataset()
        dataset.point_total_records = None
        PointHandler().extract_features(dataset)
        assert dataset.feature_kind == "profiles"


class TestHandlerRegistration:
    def test_attributes(self):
        handler = PointHandler()
        assert handler.cdm_data_type == "Point"
        assert handler.data_structure == "table"
        assert handler.feature_kind == "profiles"

    def test_points_have_no_track(self):
        """Points are unordered — there is no path to draw between them."""
        assert PointHandler().extract_track_points(build_point_dataset()) is None
