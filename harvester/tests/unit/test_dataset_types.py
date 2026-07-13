"""Unit tests for the dataset-type handler registry (cde_harvester.dataset_types)."""

from unittest.mock import MagicMock

import pytest

from cde_harvester.dataset_types import (
    extract_features,
    get_handler,
    supported_cdm_data_types,
    supported_data_structures,
)
from cde_harvester.dataset_types.base import DatasetTypeHandler
from cde_harvester.dataset_types.timeseries_profile import TimeSeriesProfileHandler


class TestRegistry:
    def test_supported_cdm_data_types(self):
        # Order matters: first three must match the legacy allowlist so skip
        # messages stay stable; trajectory types were added in M2, Grid in M3.
        assert supported_cdm_data_types() == [
            "TimeSeries",
            "Profile",
            "TimeSeriesProfile",
            "Trajectory",
            "TrajectoryProfile",
            "Grid",
        ]

    def test_supported_data_structures(self):
        # Grid registration flips the allDatasets listing to both structures.
        assert supported_data_structures() == ("table", "grid")

    def test_get_handler_returns_registered_handler(self):
        handler = get_handler("TimeSeriesProfile")
        assert isinstance(handler, TimeSeriesProfileHandler)

    def test_get_handler_unknown_type_returns_none(self):
        assert get_handler("Point") is None

    def test_extract_features_unknown_type_raises(self):
        dataset = MagicMock()
        dataset.cdm_data_type = "Point"
        with pytest.raises(KeyError, match="Point"):
            extract_features(dataset)

    def test_feature_kinds(self):
        for cdm_type in ("TimeSeries", "Profile", "TimeSeriesProfile"):
            assert get_handler(cdm_type).feature_kind == "profiles"
        for cdm_type in ("Trajectory", "TrajectoryProfile"):
            assert get_handler(cdm_type).feature_kind == "trajectory_cells"
        assert get_handler("Grid").feature_kind == "dataset_extent"
        assert get_handler("Grid").data_structure == "grid"


class TestAdjustFeatureIdentity:
    def test_default_hook_is_a_no_op(self):
        class Dummy(DatasetTypeHandler):
            cdm_data_type = "Dummy"

            def extract_features(self, dataset):
                return None

        pw, pv, pvl = object(), {"a": 1}, ["a"]
        out = Dummy().adjust_feature_identity(MagicMock(), pw, None, pv, pvl)
        assert out == (pw, pv, pvl)
