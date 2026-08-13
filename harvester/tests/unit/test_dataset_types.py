"""Unit tests for the dataset-type handler registry (cde_harvester.dataset_types)."""

from unittest.mock import MagicMock, patch

import pytest

from cde_harvester.dataset_types import (
    extract_features,
    feature_kind_for,
    get_handler,
    supported_cdm_data_types,
    supported_data_structures,
    validate,
)
from cde_harvester.dataset_types.base import DatasetQualityReport, DatasetTypeHandler
from cde_harvester.dataset_types.timeseries_profile import TimeSeriesProfileHandler


class TestRegistry:
    def test_supported_cdm_data_types(self):
        # Order matters: first three must match the legacy allowlist so skip
        # messages stay stable; trajectory types were added in M2, Grid in M3,
        # Point last (it is gated by structural QC, see point_quality).
        assert supported_cdm_data_types() == [
            "TimeSeries",
            "Profile",
            "TimeSeriesProfile",
            "Trajectory",
            "TrajectoryProfile",
            "Grid",
            "Point",
        ]

    def test_supported_data_structures(self):
        # Grid registration flips the allDatasets listing to both structures.
        assert supported_data_structures() == ("table", "grid")

    def test_get_handler_returns_registered_handler(self):
        handler = get_handler("TimeSeriesProfile")
        assert isinstance(handler, TimeSeriesProfileHandler)

    def test_get_handler_unknown_type_returns_none(self):
        assert get_handler("Swath") is None

    def test_extract_features_unknown_type_raises(self):
        dataset = MagicMock()
        dataset.cdm_data_type = "Swath"
        with pytest.raises(KeyError, match="Swath"):
            extract_features(dataset)

    def test_feature_kinds(self):
        for cdm_type in ("TimeSeries", "Profile", "TimeSeriesProfile", "Point"):
            assert get_handler(cdm_type).feature_kind == "profiles"
        for cdm_type in ("Trajectory", "TrajectoryProfile"):
            assert get_handler(cdm_type).feature_kind == "trajectory_cells"
        assert get_handler("Grid").feature_kind == "dataset_extent"
        assert get_handler("Grid").data_structure == "grid"
        assert get_handler("Point").data_structure == "table"

    def test_feature_kind_for_prefers_the_dataset_override(self):
        """Point picks its destination table per dataset, so a Dataset
        carrying feature_kind wins over the handler's class default."""
        dataset = MagicMock()
        dataset.cdm_data_type = "Point"
        dataset.feature_kind = "trajectory_cells"
        assert feature_kind_for(dataset) == "trajectory_cells"

        dataset.feature_kind = None
        assert feature_kind_for(dataset) == "profiles"
        # Bare strings still work — the pre-existing call shape.
        assert feature_kind_for("Point") == "profiles"


class TestValidateHook:
    def test_default_hook_accepts(self):
        """Every type except Point declares what it is and is taken at its
        word; only Point has to prove it."""
        for cdm_type in ("TimeSeries", "Profile", "Trajectory", "Grid"):
            assert get_handler(cdm_type).validate(MagicMock()) is None

    def test_unknown_type_accepts(self):
        dataset = MagicMock()
        dataset.cdm_data_type = "Swath"
        assert validate(dataset) is None

    def test_point_dispatches_to_its_quality_checks(self):
        dataset = MagicMock()
        dataset.cdm_data_type = "Point"
        report = DatasetQualityReport("POINT_TEST", "because")
        with patch(
            "cde_harvester.dataset_types.point.point_quality.check_point_dataset",
            return_value=report,
        ) as check:
            assert validate(dataset) is report
        check.assert_called_once_with(dataset)


class TestAdjustFeatureIdentity:
    def test_default_hook_is_a_no_op(self):
        class Dummy(DatasetTypeHandler):
            cdm_data_type = "Dummy"

            def extract_features(self, dataset):
                return None

        pw, pv, pvl = object(), {"a": 1}, ["a"]
        out = Dummy().adjust_feature_identity(MagicMock(), pw, None, pv, pvl)
        assert out == (pw, pv, pvl)
