"""
Unit tests for cde_harvester.ckan.create_ckan_erddap_link.

All outbound CKAN HTTP calls are intercepted with pytest-mock so the tests run
offline and deterministically.
"""

import json

import pandas as pd
import pytest

from conftest import (
    CKAN_EMPTY_RESPONSE,
    CKAN_PACKAGE_SEARCH_RESPONSE,
    DATASET_ID,
    ERDDAP_URL,
)
from cde_harvester.ckan.create_ckan_erddap_link import (
    get_ckan_records,
    split_erddap_url,
    unescape_ascii,
    unescape_ascii_list,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ckan_get(mocker, pages):
    """
    Patch requests.get inside the ckan module with a sequence of page responses.
    Each call to list_ckan_records_with_erddap_urls paginates until results empty.
    """
    responses = []
    for page in pages:
        mock_resp = mocker.MagicMock()
        mock_resp.json.return_value = page
        responses.append(mock_resp)

    mocker.patch(
        "cde_harvester.ckan.create_ckan_erddap_link.requests.get",
        side_effect=responses,
    )


# ---------------------------------------------------------------------------
# Tests: URL parsing
# ---------------------------------------------------------------------------

class TestSplitErddapUrl:
    def test_standard_tabledap_url(self):
        host, ds_id = split_erddap_url(
            "https://data.cioospacific.ca/erddap/tabledap/IOS_BOT_Profiles.html"
        )
        assert host == "https://data.cioospacific.ca"
        assert ds_id == "IOS_BOT_Profiles"

    def test_url_with_language_prefix(self):
        host, ds_id = split_erddap_url(
            "https://cnodc.example.ca/erddap/fr/tabledap/cnodc_dataset.html"
        )
        assert ds_id == "cnodc_dataset"

    def test_invalid_url_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid URL format"):
            split_erddap_url("https://example.com/not/erddap")


# ---------------------------------------------------------------------------
# Tests: ASCII unescaping
# ---------------------------------------------------------------------------

class TestUnescapeAscii:
    def test_plain_string_unchanged(self):
        assert unescape_ascii("hello") == "hello"

    def test_unicode_escape_decoded(self):
        assert unescape_ascii(r"Café") == "Café"

    def test_unicode_escape_in_french_title(self):
        assert unescape_ascii(r"Institut für Meeresforschung") == "Institut für Meeresforschung"

    def test_multiple_escapes_in_one_string(self):
        assert unescape_ascii(r"élève") == "élève"

    def test_non_ascii_fallback_returns_input(self):
        # Passing a non-decodable sequence should return the original value
        result = unescape_ascii(b"\xff\xfe")
        assert result == b"\xff\xfe"

    def test_list_unescaping(self):
        result = unescape_ascii_list(["hello", "world"])
        assert result == ["hello", "world"]

    def test_list_unescaping_with_escapes(self):
        result = unescape_ascii_list([r"Café", r"Institut für Meeresforschung"])
        assert result == ["Café", "Institut für Meeresforschung"]


# ---------------------------------------------------------------------------
# Tests: get_ckan_records
# ---------------------------------------------------------------------------

class TestGetCkanRecords:
    def test_returns_dataframe(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE, CKAN_EMPTY_RESPONSE])
        df = get_ckan_records([DATASET_ID])
        assert isinstance(df, pd.DataFrame)

    def test_dataframe_has_expected_columns(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE, CKAN_EMPTY_RESPONSE])
        df = get_ckan_records([DATASET_ID])
        for col in ["erddap_url", "dataset_id", "ckan_id", "ckan_organizations", "ckan_title", "title_fr"]:
            assert col in df.columns

    def test_dataset_id_matched(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE, CKAN_EMPTY_RESPONSE])
        df = get_ckan_records([DATASET_ID])
        assert DATASET_ID in df["dataset_id"].values

    def test_title_extracted(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE, CKAN_EMPTY_RESPONSE])
        df = get_ckan_records([DATASET_ID])
        row = df[df["dataset_id"] == DATASET_ID].iloc[0]
        assert row["ckan_title"] == "Test Dataset English Title"
        assert row["title_fr"] == "Test Dataset French Title"

    def test_no_matching_dataset_returns_empty(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE, CKAN_EMPTY_RESPONSE])
        df = get_ckan_records(["non_existent_dataset"])
        assert df.empty
