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
    def test_supported_cdm_data_types_matches_legacy_allowlist(self):
        # Order and content must match the old CDM_DATA_TYPES_SUPPORTED list so
        # skip messages and behavior stay identical.
        assert supported_cdm_data_types() == [
            "TimeSeries",
            "Profile",
            "TimeSeriesProfile",
        ]

    def test_only_tabledap_structures_today(self):
        assert supported_data_structures() == ("table",)

    def test_get_handler_returns_registered_handler(self):
        handler = get_handler("TimeSeriesProfile")
        assert isinstance(handler, TimeSeriesProfileHandler)

    def test_get_handler_unknown_type_returns_none(self):
        assert get_handler("Trajectory") is None

    def test_extract_features_unknown_type_raises(self):
        dataset = MagicMock()
        dataset.cdm_data_type = "Trajectory"
        with pytest.raises(KeyError, match="Trajectory"):
            extract_features(dataset)

    def test_default_feature_kind_is_profiles(self):
        for cdm_type in supported_cdm_data_types():
            assert get_handler(cdm_type).feature_kind == "profiles"


class TestAdjustFeatureIdentity:
    def test_default_hook_is_a_no_op(self):
        class Dummy(DatasetTypeHandler):
            cdm_data_type = "Dummy"

            def extract_features(self, dataset):
                return None

        pw, pv, pvl = object(), {"a": 1}, ["a"]
        out = Dummy().adjust_feature_identity(MagicMock(), pw, None, pv, pvl)
        assert out == (pw, pv, pvl)
