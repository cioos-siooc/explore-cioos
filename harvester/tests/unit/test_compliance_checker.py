"""
Unit tests for cde_harvester.CDEComplianceChecker.

Each test builds a mock Dataset, sets specific attributes, and verifies
whether the compliance checker passes or rejects it with the right code.
"""

import pytest

from conftest import (
    ERDDAP_INFO_CSV,
    ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV,
    ERDDAP_INFO_INGEST_FALSE_CSV,
    ERDDAP_INFO_NO_EOVS_CSV,
    build_mock_dataset,
)
from cde_harvester.CDEComplianceChecker import CDEComplianceChecker
from cde_harvester.harvest_errors import (
    DEPTH_AND_ALTITUDE,
    INGEST_FLAG_FALSE,
    MISSING_REQUIRED_VARS,
    NO_SUPPORTED_VARIABLES,
)


def _checker(info_csv=ERDDAP_INFO_CSV, **overrides):
    """Build a CDEComplianceChecker from a mock dataset, with optional overrides."""
    dataset = build_mock_dataset(info_csv)
    for attr, value in overrides.items():
        setattr(dataset, attr, value)
    return CDEComplianceChecker(dataset)


class TestPassesAllChecks:
    def test_valid_timeseries_dataset_passes(self):
        checker = _checker()
        assert checker.passes_all_checks() is True

    def test_failure_reason_code_empty_on_pass(self):
        checker = _checker()
        checker.passes_all_checks()
        assert checker.failure_reason_code == ""


class TestRequiredVariables:
    def test_missing_time_fails(self):
        checker = _checker()
        # Remove 'time' from variables_list
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "time"
        ]
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS

    def test_missing_latitude_fails(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "latitude"
        ]
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS

    def test_missing_longitude_fails(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "longitude"
        ]
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS

    def test_all_required_present_passes(self):
        checker = _checker()
        assert checker.check_required_variables() is True


class TestSupportedCFName:
    def test_dataset_with_sea_water_temperature_passes(self):
        checker = _checker()
        assert checker.check_supported_cf_name() is True

    def test_dataset_with_no_supported_standard_names_fails(self):
        checker = _checker(ERDDAP_INFO_NO_EOVS_CSV)
        assert checker.check_supported_cf_name() is False
        assert checker.failure_reason_code == NO_SUPPORTED_VARIABLES


class TestIngestFlag:
    def test_no_cde_ingest_flag_passes(self):
        checker = _checker()
        # globals has no cde_ingest key
        assert checker.cde_ingest_flag() is True

    def test_cde_ingest_false_fails(self):
        checker = _checker(ERDDAP_INFO_INGEST_FALSE_CSV)
        assert checker.cde_ingest_flag() is False
        assert checker.failure_reason_code == INGEST_FLAG_FALSE

    def test_cde_ingest_true_passes(self):
        checker = _checker()
        checker.dataset.globals["cde_ingest"] = "True"
        assert checker.cde_ingest_flag() is True


class TestDepthAndAltitude:
    def test_only_depth_passes(self):
        checker = _checker()
        assert "depth" in checker.dataset.variables_list
        assert "altitude" not in checker.dataset.variables_list
        assert checker.check_only_one_depth() is True

    def test_depth_and_altitude_together_fails(self):
        checker = _checker(ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV)
        assert checker.check_only_one_depth() is False
        assert checker.failure_reason_code == DEPTH_AND_ALTITUDE

    def test_only_altitude_passes(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "depth"
        ] + ["altitude"]
        assert checker.check_only_one_depth() is True
