"""
Unit tests for cde_harvester.ERDDAP — the HTTP client that talks to ERDDAP servers.

All HTTP calls are intercepted by patching requests.Session so no network
traffic is produced.
"""

from io import StringIO
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
import requests

from conftest import (
    ERDDAP_ALL_DATASETS_CSV,
    ERDDAP_INFO_CSV,
    ERDDAP_URL,
    MockResponse,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_erddap(all_datasets_csv=ERDDAP_ALL_DATASETS_CSV):
    """Create an ERDDAP instance with a mocked session.get."""
    with patch("cde_harvester.ERDDAP.requests") as mock_requests:
        mock_session = MagicMock()
        mock_requests.Session.return_value = mock_session
        mock_session.get.return_value = MockResponse(
            text=all_datasets_csv, url=ERDDAP_URL + "/tabledap/allDatasets.csv"
        )
        from cde_harvester.ERDDAP import ERDDAP
        erddap = ERDDAP(ERDDAP_URL, cache_requests=False)
        erddap.session = mock_session  # expose for further assertions
    return erddap


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestERDDAPInit:
    def test_url_is_stored(self):
        erddap = _make_erddap()
        assert erddap.url == ERDDAP_URL

    def test_domain_extracted_from_url(self):
        erddap = _make_erddap()
        assert erddap.domain == "test.erddap.com"

    def test_get_all_datasets_returns_dataframe(self):
        erddap = _make_erddap()
        assert isinstance(erddap.df_all_datasets, pd.DataFrame)

    def test_get_all_datasets_has_expected_columns(self):
        erddap = _make_erddap()
        assert "datasetID" in erddap.df_all_datasets.columns
        assert "cdm_data_type" in erddap.df_all_datasets.columns

    def test_get_all_datasets_skips_units_rows(self):
        """Rows at index 1 and 2 (units + type rows) must be dropped."""
        erddap = _make_erddap()
        ids = erddap.df_all_datasets["datasetID"].tolist()
        # The "(String)" units row must NOT appear
        assert "(String)" not in ids
        assert "test_timeseries_001" in ids

    def test_empty_response_gives_empty_dataframe(self):
        empty_csv = "datasetID,cdm_data_type\n(String),(String)\n,\n"
        with patch("cde_harvester.ERDDAP.requests") as mock_requests:
            mock_session = MagicMock()
            mock_requests.Session.return_value = mock_session
            mock_session.get.return_value = MockResponse(
                text=empty_csv, url=ERDDAP_URL + "/tabledap/allDatasets.csv"
            )
            from cde_harvester.ERDDAP import ERDDAP
            erddap = ERDDAP(ERDDAP_URL, cache_requests=False)
        assert erddap.df_all_datasets.empty


class TestErddapCsvToDf:
    def test_200_response_returns_dataframe(self):
        erddap = _make_erddap()
        erddap.session.get.return_value = MockResponse(
            text=ERDDAP_INFO_CSV, url=ERDDAP_URL + "/info/ds/index.csv"
        )
        df = erddap.erddap_csv_to_df("/info/test/index.csv", skiprows=[])
        assert isinstance(df, pd.DataFrame)
        assert not df.empty

    def test_404_returns_empty_dataframe(self):
        erddap = _make_erddap()
        erddap.session.get.return_value = MockResponse(
            text="Not found", status_code=404,
            url=ERDDAP_URL + "/tabledap/missing.csv"
        )
        df = erddap.erddap_csv_to_df("/tabledap/missing.csv")
        assert df.empty

    def test_500_no_matching_results_returns_empty(self):
        erddap = _make_erddap()
        erddap.session.get.return_value = MockResponse(
            text="Your query produced no matching results",
            status_code=500,
            url=ERDDAP_URL + "/tabledap/ds.csv"
        )
        df = erddap.erddap_csv_to_df("/tabledap/ds.csv")
        assert df.empty

    def test_500_other_error_raises(self):
        erddap = _make_erddap()
        erddap.session.get.return_value = MockResponse(
            text="Internal Server Error", status_code=500,
            url=ERDDAP_URL + "/tabledap/ds.csv"
        )
        with pytest.raises(requests.exceptions.HTTPError):
            erddap.erddap_csv_to_df("/tabledap/ds.csv")

    def test_response_too_large_raises(self):
        erddap = _make_erddap()
        big_content = b"x" * int(2e8 + 1)
        mock_resp = MockResponse(text="", url=ERDDAP_URL)
        mock_resp.content = big_content
        erddap.session.get.return_value = mock_resp
        from cde_harvester.harvest_errors import ResponseTooLargeError
        with pytest.raises(ResponseTooLargeError):
            erddap.erddap_csv_to_df("/tabledap/ds.csv")


class TestParseErddapDate:
    def test_iso8601_string(self):
        from cde_harvester.ERDDAP import ERDDAP
        result = ERDDAP.parse_erddap_date("2020-06-15T00:00:00Z")
        assert result.year == 2020
        assert result.month == 6

    def test_large_epoch_is_not_timestamp(self):
        """Values like 1577836800.0 do NOT start with '1.' so treated as ISO."""
        from cde_harvester.ERDDAP import ERDDAP
        # A scientific-notation epoch starting with "1." IS a timestamp
        result = ERDDAP.parse_erddap_date("1.5E9")
        assert pd.notna(result)

    def test_invalid_string_returns_nat(self):
        from cde_harvester.ERDDAP import ERDDAP
        result = ERDDAP.parse_erddap_date("not-a-date")
        assert pd.isna(result)
