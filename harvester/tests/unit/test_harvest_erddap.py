"""
Unit tests for cde_harvester.erddap_harvester.harvest_erddap.

The ERDDAP class constructor is patched so no HTTP calls are made.
Individual Dataset objects are returned as pre-built MagicMocks.
harvest_erddap is a Prefect @task; the prefect_test_server session fixture
(conftest.py) provides an ephemeral API so the task can be called directly.
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
from cde_harvester.erddap_harvester import (
    harvest_erddap,
    harvest_dataset,
    DatasetHarvestResult,
    DatasetHarvestError,
)
from cde_harvester.harvest_errors import (
    CDM_DATA_TYPE_UNSUPPORTED,
    HTTP_ERROR,
    UNCHANGED,
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
    harvest_erddap is called directly; the prefect_test_server fixture provides the API.
    """
    with (
        patch("cde_harvester.erddap_harvester.ERDDAP", return_value=erddap_mock),
        patch("cde_harvester.erddap_harvester.get_profiles") as mock_get_profiles,
    ):
        if dataset_mock is None:
            dataset_mock = build_mock_dataset()

        mock_get_profiles.return_value = _make_profiles_df()
        erddap_mock.get_dataset.return_value = dataset_mock

        return harvest_erddap(ERDDAP_URL, limit_dataset_ids=limit)


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
            result = harvest_erddap(ERDDAP_URL)

        assert HTTP_ERROR in result.skipped["reason_code"].values


# ---------------------------------------------------------------------------
# Tests: skip_unchanged (Croissant hash caching)
# ---------------------------------------------------------------------------

class TestSkipUnchanged:
    def test_skip_unchanged_when_hash_matches(self):
        """When the Croissant hash matches the previous hash, the dataset is skipped."""
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        prev_hash = "deadbeef" * 8  # 64-char hex string
        erddap_mock.get_croissant_fingerprint.return_value = (prev_hash, True, None)

        with (
            patch("cde_harvester.erddap_harvester.ERDDAP", return_value=erddap_mock),
            patch("cde_harvester.erddap_harvester.get_profiles"),
            patch(
                "cde_harvester.erddap_harvester.load_previous_hashes",
                return_value={DATASET_ID: prev_hash},
            ),
        ):
            result = harvest_erddap(ERDDAP_URL, skip_unchanged=True)

        # Dataset should NOT appear in datasets or profiles (it was skipped)
        assert DATASET_ID not in result.datasets["dataset_id"].values
        # It should appear in the verified DataFrame
        assert DATASET_ID in result.verified["dataset_id"].values

    def test_skip_unchanged_false_still_harvests(self):
        """skip_unchanged=False harvests even if hash matches."""
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        prev_hash = "deadbeef" * 8
        erddap_mock.get_croissant_fingerprint.return_value = (prev_hash, True, None)

        with (
            patch("cde_harvester.erddap_harvester.ERDDAP", return_value=erddap_mock),
            patch("cde_harvester.erddap_harvester.get_profiles") as mock_profiles,
            patch(
                "cde_harvester.erddap_harvester.load_previous_hashes",
                return_value={DATASET_ID: prev_hash},
            ),
        ):
            mock_profiles.return_value = _make_profiles_df()
            erddap_mock.get_dataset.return_value = build_mock_dataset()
            result = harvest_erddap(ERDDAP_URL, skip_unchanged=False)

        # Dataset must be fully harvested since skip_unchanged is False
        assert DATASET_ID in result.datasets["dataset_id"].values
        assert result.verified.empty

    def test_new_hash_triggers_harvest_even_with_skip_unchanged(self):
        """A changed hash (new != prev) forces a full harvest."""
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        erddap_mock.get_croissant_fingerprint.return_value = ("new_hash_xyz", True, None)

        with (
            patch("cde_harvester.erddap_harvester.ERDDAP", return_value=erddap_mock),
            patch("cde_harvester.erddap_harvester.get_profiles") as mock_profiles,
            patch(
                "cde_harvester.erddap_harvester.load_previous_hashes",
                return_value={DATASET_ID: "old_hash_abc"},
            ),
        ):
            mock_profiles.return_value = _make_profiles_df()
            erddap_mock.get_dataset.return_value = build_mock_dataset()
            result = harvest_erddap(ERDDAP_URL, skip_unchanged=True)

        assert DATASET_ID in result.datasets["dataset_id"].values
        assert result.verified.empty

    def test_no_file_list_skips_caching(self):
        """When has_files is False, the dataset is harvested regardless."""
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        prev_hash = "deadbeef" * 8
        # has_files=False — no file list, so skip logic must NOT trigger
        erddap_mock.get_croissant_fingerprint.return_value = (None, False, "HASH_NO_FILE_LIST")

        with (
            patch("cde_harvester.erddap_harvester.ERDDAP", return_value=erddap_mock),
            patch("cde_harvester.erddap_harvester.get_profiles") as mock_profiles,
            patch(
                "cde_harvester.erddap_harvester.load_previous_hashes",
                return_value={DATASET_ID: prev_hash},
            ),
        ):
            mock_profiles.return_value = _make_profiles_df()
            erddap_mock.get_dataset.return_value = build_mock_dataset()
            result = harvest_erddap(ERDDAP_URL, skip_unchanged=True)

        assert DATASET_ID in result.datasets["dataset_id"].values


# ---------------------------------------------------------------------------
# Tests: DatasetHarvestResult and DatasetHarvestError dataclasses
# ---------------------------------------------------------------------------

class TestDatasetHarvestResult:
    def test_success_status(self):
        r = DatasetHarvestResult(
            status="success",
            attempt={"run_id": "r1", "dataset_id": DATASET_ID},
        )
        assert r.status == "success"

    def test_skipped_unchanged_has_verified_at(self):
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc)
        r = DatasetHarvestResult(
            status="skipped_unchanged",
            attempt={},
            verified_at=ts,
        )
        assert r.verified_at == ts

    def test_defaults_are_none(self):
        r = DatasetHarvestResult(status="skipped", attempt={})
        assert r.profiles is None
        assert r.dataset_df is None
        assert r.variables is None
        assert r.skipped_reason_code is None
        assert r.verified_at is None


class TestDatasetHarvestError:
    def test_carries_attempt_and_reason_code(self):
        attempt = {"run_id": "r1", "status": "error"}
        err = DatasetHarvestError(
            attempt=attempt,
            skipped_reason_code=HTTP_ERROR,
            message="HTTP 500 Internal Server Error",
        )
        assert err.attempt == attempt
        assert err.skipped_reason_code == HTTP_ERROR

    def test_is_exception(self):
        err = DatasetHarvestError(attempt={}, skipped_reason_code="X", message="boom")
        assert isinstance(err, Exception)


# ---------------------------------------------------------------------------
# Tests: harvest_result.verified DataFrame
# ---------------------------------------------------------------------------

class TestHarvestResultVerified:
    def test_verified_dataframe_in_result(self):
        """HarvestResult always has a .verified DataFrame (even empty)."""
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock)
        import pandas as pd
        assert isinstance(result.verified, pd.DataFrame)

    def test_verified_columns_present(self):
        erddap_mock = _make_erddap_mock([(DATASET_ID, "TimeSeries")])
        result = _run_harvest(erddap_mock)
        for col in ["erddap_url", "dataset_id", "verified_at"]:
            assert col in result.verified.columns
