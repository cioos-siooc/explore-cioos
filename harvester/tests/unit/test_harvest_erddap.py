"""
Unit tests for cde_harvester.erddap_harvester.harvest_erddap.

The ERDDAP class constructor is patched so no HTTP calls are made.
Individual Dataset objects are returned as pre-built MagicMocks.
harvest_erddap is a Prefect @task; .fn() bypasses the task wrapper.
"""

import pandas as pd
import pytest
from unittest.mock import MagicMock, patch

from conftest import (
    DATASET_ID,
    ERDDAP_URL,
    build_mock_dataset,
    ERDDAP_INFO_NO_EOVS_CSV,
)
from cde_harvester.erddap_harvester import harvest_erddap
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
    # harvest() now (re)loads the dataset list via get_all_datasets() rather than
    # reading a pre-set df_all_datasets attribute, so stub the call too.
    mock_erddap.get_all_datasets.return_value = df
    mock_erddap.get_logger.return_value = __import__("logging").getLogger("test")
    # Caching: harvest_dataset() unpacks get_croissant_fingerprint() into
    # (content_hash, has_files, reason). Stub it so the bare MagicMock doesn't
    # unpack to 0 values; has_files=False means skip_unchanged never triggers.
    mock_erddap.get_croissant_fingerprint.return_value = (None, False, None)
    return mock_erddap


def _make_profiles_df():
    return pd.DataFrame({
        "timeseries_id": ["STATION_001"],
        "latitude": [48.5],
        "longitude": [-125.0],
        "time_min": [pd.Timestamp("2020-01-01", tz="UTC")],
        "time_max": [pd.Timestamp("2023-12-31", tz="UTC")],
        "depth_min": [0.5],
        "depth_max": [200.5],
        "n_records": [1000.0],
        "records_per_day": [0.75],
        "dataset_id": [DATASET_ID],
        "erddap_url": [ERDDAP_URL],
        "profile_id": [""],
    })


def _run_harvest(erddap_mock, dataset_mock=None, limit=None):
    """
    Patch erddap_harvester.ERDDAP and get_profiles, then call harvest_erddap.
    Returns a HarvestResult with .profiles, .datasets, .variables, .skipped.
    Uses .fn() to bypass the Prefect @task decorator.
    """
    with (
        patch("cde_harvester.erddap_harvester.ERDDAP", return_value=erddap_mock),
        patch("cde_harvester.erddap_harvester.get_profiles") as mock_get_profiles,
    ):
        if dataset_mock is None:
            dataset_mock = build_mock_dataset()

        mock_get_profiles.return_value = _make_profiles_df()
        erddap_mock.get_dataset.return_value = dataset_mock

        return harvest_erddap.fn(ERDDAP_URL, limit_dataset_ids=limit)


class TestHarvestErddapHappyPath:
    def test_result_has_dataframe_fields(self):
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock)
        assert isinstance(result.profiles, pd.DataFrame)
        assert isinstance(result.datasets, pd.DataFrame)
        assert isinstance(result.variables, pd.DataFrame)
        assert isinstance(result.skipped, pd.DataFrame)

    def test_compliant_dataset_appears_in_datasets(self):
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock)
        assert DATASET_ID in result.datasets["dataset_id"].values

    def test_dataset_id_filter_respected(self):
        erddap_mock = _make_erddap_mock([
            (DATASET_ID, "TimeSeries"),
            ("other_dataset", "TimeSeries"),
        ])
        result = _run_harvest(erddap_mock, limit=[DATASET_ID])
        assert DATASET_ID in result.datasets["dataset_id"].values
        assert "other_dataset" not in result.datasets["dataset_id"].values


class TestHarvestErddapSkipping:
    def test_unsupported_cdm_type_skipped(self):
        erddap_mock = _make_erddap_mock([("bad_ds", "Point")])
        result = _run_harvest(erddap_mock)
        assert "bad_ds" in result.skipped["dataset_id"].values
        assert CDM_DATA_TYPE_UNSUPPORTED in result.skipped["reason_code"].values

    def test_non_compliant_dataset_added_to_skipped(self):
        """A dataset with no EOVs should fail compliance and appear in skipped."""
        non_compliant = build_mock_dataset(ERDDAP_INFO_NO_EOVS_CSV)
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock, dataset_mock=non_compliant)
        assert DATASET_ID not in result.datasets["dataset_id"].values
        assert DATASET_ID in result.skipped["dataset_id"].values

    def test_http_error_adds_to_skipped(self):
        import requests
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.reason = "Internal Server Error"
        erddap_mock.get_dataset.side_effect = requests.exceptions.HTTPError(
            response=mock_response
        )

        with (
            patch("cde_harvester.erddap_harvester.ERDDAP", return_value=erddap_mock),
            patch("cde_harvester.erddap_harvester.get_profiles"),
        ):
            result = harvest_erddap.fn(ERDDAP_URL)

        assert HTTP_ERROR in result.skipped["reason_code"].values
