"""
Unit tests for cde_harvester.harvest_erddap.harvest_erddap.

The ERDDAP class constructor is patched so no HTTP calls are made.
Individual Dataset objects are returned as pre-built MagicMocks.
"""

import pandas as pd
import pytest
from unittest.mock import MagicMock, patch

from conftest import (
    DATASET_ID,
    ERDDAP_URL,
    build_mock_dataset,
)
from cde_harvester.harvest_erddap import harvest_erddap
from cde_harvester.harvest_errors import (
    CDM_DATA_TYPE_UNSUPPORTED,
    HTTP_ERROR,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _make_erddap_mock(datasets: list[tuple], domain: str = "test.erddap.com"):
    """
    Build a mock ERDDAP instance whose df_all_datasets contains the given rows.
    Each tuple is (datasetID, cdm_data_type).
    """
    mock_erddap = MagicMock()
    mock_erddap.domain = domain
    mock_erddap.url = ERDDAP_URL

    df = pd.DataFrame(datasets, columns=["datasetID", "cdm_data_type"])
    mock_erddap.df_all_datasets = df
    mock_erddap.get_logger.return_value = __import__("logging").getLogger("test")
    return mock_erddap


def _run_harvest(erddap_mock, dataset_mock=None, limit=None):
    """
    Patch harvest_erddap.ERDDAP and get_profiles, then call harvest_erddap().
    Returns the result list.
    """
    with (
        patch("cde_harvester.harvest_erddap.ERDDAP", return_value=erddap_mock),
        patch("cde_harvester.harvest_erddap.get_profiles") as mock_get_profiles,
    ):
        if dataset_mock is None:
            dataset_mock = build_mock_dataset()

        # get_profiles returns a simple single-row DataFrame
        from io import StringIO
        profiles_df = pd.DataFrame({
            "timeseries_id": ["STATION_001"],
            "latitude": [48.5],
            "longitude": [-125.0],
            "time_min": ["2020-01-01"],
            "time_max": ["2023-12-31"],
            "depth_min": [0.5],
            "depth_max": [200.5],
            "n_records": [1000.0],
            "records_per_day": [0.75],
            "dataset_id": [DATASET_ID],
            "erddap_url": [ERDDAP_URL],
            "profile_id": [""],
        })
        mock_get_profiles.return_value = profiles_df

        erddap_mock.get_dataset.return_value = dataset_mock

        result = []
        harvest_erddap(ERDDAP_URL, result, limit_dataset_ids=limit)
        return result


class TestHarvestErddapHappyPath:
    def test_result_appended(self):
        erddap_mock = _make_erddap_mock([
            (DATASET_ID, "TimeSeries"),
        ])
        result = _run_harvest(erddap_mock)
        assert len(result) == 1

    def test_result_contains_four_dataframes(self):
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock)
        profiles, datasets, variables, skipped = result[0]
        assert isinstance(profiles, pd.DataFrame)
        assert isinstance(datasets, pd.DataFrame)
        assert isinstance(variables, pd.DataFrame)
        assert isinstance(skipped, pd.DataFrame)

    def test_compliant_dataset_appears_in_datasets(self):
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock)
        _, datasets, _, _ = result[0]
        assert DATASET_ID in datasets["dataset_id"].values

    def test_dataset_id_filter_respected(self):
        erddap_mock = _make_erddap_mock([
            (DATASET_ID, "TimeSeries"),
            ("other_dataset", "TimeSeries"),
        ])
        result = _run_harvest(erddap_mock, limit=[DATASET_ID])
        _, datasets, _, _ = result[0]
        # Only the filtered ID should appear
        assert DATASET_ID in datasets["dataset_id"].values
        assert "other_dataset" not in datasets["dataset_id"].values


class TestHarvestErddapSkipping:
    def test_unsupported_cdm_type_skipped(self):
        erddap_mock = _make_erddap_mock([("bad_ds", "Point")])
        result = _run_harvest(erddap_mock)
        _, _, _, skipped = result[0]
        assert "bad_ds" in skipped["dataset_id"].values
        assert CDM_DATA_TYPE_UNSUPPORTED in skipped["reason_code"].values

    def test_non_compliant_dataset_added_to_skipped(self):
        """A dataset that fails compliance checks should appear in skipped."""
        from conftest import ERDDAP_INFO_NO_EOVS_CSV
        non_compliant = build_mock_dataset(ERDDAP_INFO_NO_EOVS_CSV)
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock, dataset_mock=non_compliant)
        _, datasets, _, skipped = result[0]
        assert DATASET_ID not in datasets["dataset_id"].values
        assert DATASET_ID in skipped["dataset_id"].values

    def test_http_error_adds_to_skipped(self):
        import requests
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])

        # Make get_dataset raise an HTTPError
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.reason = "Internal Server Error"
        erddap_mock.get_dataset.side_effect = requests.exceptions.HTTPError(
            response=mock_response
        )

        with (
            patch("cde_harvester.harvest_erddap.ERDDAP", return_value=erddap_mock),
            patch("cde_harvester.harvest_erddap.get_profiles"),
        ):
            result = []
            harvest_erddap(ERDDAP_URL, result)

        _, _, _, skipped = result[0]
        assert HTTP_ERROR in skipped["reason_code"].values
