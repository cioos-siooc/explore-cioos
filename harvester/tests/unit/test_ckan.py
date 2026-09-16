"""
Unit tests for cde_harvester.sources.ckan.create_ckan_erddap_link.

All outbound CKAN HTTP calls are intercepted with pytest-mock so the tests run
offline and deterministically.
"""


import pandas as pd
import pytest
import requests
from cde_harvester.sources.ckan.create_ckan_erddap_link import (
    ckan_erddap_links,
    ckan_obis_links,
    fetch_ckan_catalogue,
    fetch_obis_record_ids,
    obis_uuid_from_xml_location,
    parse_ckan_package,
    split_erddap_url,
    unescape_ascii,
    unescape_ascii_list,
)
from conftest import (
    CKAN_PACKAGE_SEARCH_RESPONSE,
    DATASET_ID,
)

OBIS_UUID = "3f8c1d2e-4b5a-6c7d-8e9f-0a1b2c3d4e5f"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ckan_get(mocker, pages, obis_records=()):
    """
    Patch the CKAN session builder so session.get() yields the given page
    responses. CKAN fetching goes through a requests.Session built by
    _build_ckan_session() rather than the module-level requests.get.
    Paging stops once `count` records have been seen, or on an empty page.

    fetch_ckan_catalogue asks for the OBIS harvest source's record ids FIRST,
    so that response is prepended here. It defaults to empty, which is what the
    national catalogue actually returns today.
    """
    obis_page = {"result": {"count": len(obis_records),
                            "results": [{"id": i} for i in obis_records]}}
    responses = []
    for page in [obis_page, *pages]:
        mock_resp = mocker.MagicMock()
        mock_resp.json.return_value = page
        responses.append(mock_resp)

    mock_session = mocker.MagicMock()
    mock_session.get.side_effect = responses
    mocker.patch(
        "cde_harvester.sources.ckan.create_ckan_erddap_link._build_ckan_session",
        return_value=mock_session,
    )
    return mock_session


def _package(**overrides):
    """A minimal CKAN package, overridable per test."""
    record = {
        "id": "ckan-uuid-001",
        "name": "test-dataset",
        "title_translated": {"en": "English Title", "fr": "Titre français"},
        "cited-responsible-party": [{"organisation-name": "CIOOS Test Organization"}],
        "eov": ["seaSurfaceTemperature"],
        "resources": [],
    }
    record.update(overrides)
    return record


def _tabledap(host, dataset_id):
    return {"url": f"{host}/erddap/tabledap/{dataset_id}.html", "format": "ERDDAP tabledap"}


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


class TestObisUuidFromXmlLocation:
    def test_extracts_uuid(self):
        assert obis_uuid_from_xml_location(
            f"https://example.org/xml/{OBIS_UUID}.xml"
        ) == OBIS_UUID

    def test_uppercase_uuid_normalised(self):
        assert obis_uuid_from_xml_location(
            f"https://example.org/{OBIS_UUID.upper()}.xml"
        ) == OBIS_UUID

    def test_no_match_returns_none(self):
        assert obis_uuid_from_xml_location("https://example.org/record.html") is None

    def test_non_string_returns_none(self):
        assert obis_uuid_from_xml_location(None) is None


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
# Tests: parse_ckan_package
# ---------------------------------------------------------------------------

class TestParseCkanPackage:
    def test_single_tabledap_resource_yields_one_row(self):
        rows = parse_ckan_package(
            _package(resources=[_tabledap("https://erddap.example.com", "ds_a")])
        )
        assert len(rows) == 1
        assert rows[0]["erddap_url"] == "https://erddap.example.com/erddap"
        assert rows[0]["dataset_id"] == "ds_a"

    def test_two_tabledap_resources_yield_two_rows(self):
        """The old loop kept only the last resource; both servers must appear."""
        rows = parse_ckan_package(
            _package(resources=[
                _tabledap("https://erddap.one.ca", "shared_id"),
                _tabledap("https://erddap.two.ca", "shared_id"),
            ])
        )
        assert {r["erddap_url"] for r in rows} == {
            "https://erddap.one.ca/erddap",
            "https://erddap.two.ca/erddap",
        }

    def test_record_with_no_data_link_still_yields_a_row(self):
        """A census of CKAN, not of the matches — the record must not vanish."""
        rows = parse_ckan_package(_package(resources=[{"url": "https://example.org/a.pdf"}]))
        assert len(rows) == 1
        assert rows[0]["erddap_url"] is None
        assert rows[0]["dataset_id"] is None
        assert rows[0]["n_resources"] == 1

    def test_obis_record_carries_its_uuid(self):
        rows = parse_ckan_package(
            _package(xml_location_url=f"https://example.org/{OBIS_UUID}.xml"),
            obis_record_ids={"ckan-uuid-001"},
        )
        assert rows[0]["obis_dataset_id"] == OBIS_UUID
        assert rows[0]["erddap_url"] is None

    def test_uuid_alone_does_not_make_a_record_obis(self):
        """Every CIOOS record's xml_location_url names its own metadata file.

        Matching the UUID pattern alone tagged 488 ordinary records (geology
        and friends) as OBIS datasets against the live catalogue.
        """
        rows = parse_ckan_package(
            _package(xml_location_url=f"https://catalogue-waf.ogsl.ca/cgc/{OBIS_UUID}.xml"),
            obis_record_ids=frozenset(),
        )
        assert rows[0]["obis_dataset_id"] is None

    def test_unparseable_tabledap_url_does_not_raise(self):
        rows = parse_ckan_package(
            _package(resources=[{"url": "https://example.org/tabledap-brochure.pdf"}])
        )
        assert len(rows) == 1
        assert rows[0]["erddap_url"] is None

    def test_titles_and_organizations_extracted(self):
        rows = parse_ckan_package(_package())
        assert rows[0]["title"] == "English Title"
        assert rows[0]["title_fr"] == "Titre français"
        assert rows[0]["organizations"] == ["CIOOS Test Organization"]
        assert rows[0]["eovs"] == ["seaSurfaceTemperature"]


# ---------------------------------------------------------------------------
# Tests: fetch_ckan_catalogue
# ---------------------------------------------------------------------------

class TestFetchCkanCatalogue:
    def test_returns_dataframe_with_expected_columns(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE])
        df = fetch_ckan_catalogue.fn()
        assert isinstance(df, pd.DataFrame)
        for col in [
            "ckan_id", "ckan_name", "title", "title_fr", "organizations", "eovs",
            "erddap_url", "dataset_id", "obis_dataset_id", "n_resources", "snapshot_at",
        ]:
            assert col in df.columns

    def test_issues_no_search_filter(self, mocker):
        """The catalogue is enumerated in full — a `q=` filter would hide records."""
        session = _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE])
        fetch_ckan_catalogue.fn()
        # call 0 is the OBIS harvest-source lookup; the catalogue walk follows.
        requested = session.get.call_args_list[1][0][0]
        assert "package_search" in requested
        assert "q=" not in requested

    def test_stops_once_count_is_reached(self, mocker):
        """One page covers `count`, so no second request is made."""
        session = _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE])
        fetch_ckan_catalogue.fn()
        # One OBIS-source lookup + one catalogue page covering `count`.
        assert session.get.call_count == 2

    def test_pages_until_count_is_reached(self, mocker):
        page1 = {"result": {"count": 2, "results": [_package(id="a")]}}
        page2 = {"result": {"count": 2, "results": [_package(id="b")]}}
        session = _make_ckan_get(mocker, [page1, page2])
        df = fetch_ckan_catalogue.fn()
        assert session.get.call_count == 3  # OBIS lookup + two catalogue pages
        assert set(df["ckan_id"]) == {"a", "b"}

    def test_dataset_id_from_fixture_is_present(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE])
        df = fetch_ckan_catalogue.fn()
        assert DATASET_ID in df["dataset_id"].values

    def test_limit_stops_early(self, mocker):
        page = {"result": {"count": 3, "results": [
            _package(id="a"), _package(id="b"), _package(id="c"),
        ]}}
        _make_ckan_get(mocker, [page])
        df = fetch_ckan_catalogue.fn(limit=2)
        assert set(df["ckan_id"]) == {"a", "b"}


# ---------------------------------------------------------------------------
# Tests: derived link frames
# ---------------------------------------------------------------------------

class TestCkanErddapLinks:
    def test_drops_records_with_no_erddap_link(self, mocker):
        _make_ckan_get(mocker, [{"result": {"count": 2, "results": [
            _package(id="linked", resources=[_tabledap("https://erddap.one.ca", "ds_a")]),
            _package(id="unlinked"),
        ]}}])
        links = ckan_erddap_links(fetch_ckan_catalogue.fn())
        assert list(links["ckan_id"]) == ["linked"]

    def test_same_dataset_id_on_two_servers_is_kept(self):
        """Deduplicating on dataset_id alone silently dropped the second server."""
        catalogue = pd.DataFrame([
            {"ckan_id": "a", "title": "A", "title_fr": None, "organizations": [],
             "eovs": [], "erddap_url": "https://one.ca/erddap", "dataset_id": "shared",
             "obis_dataset_id": None, "n_resources": 1, "ckan_name": "a"},
            {"ckan_id": "b", "title": "B", "title_fr": None, "organizations": [],
             "eovs": [], "erddap_url": "https://two.ca/erddap", "dataset_id": "shared",
             "obis_dataset_id": None, "n_resources": 1, "ckan_name": "b"},
        ])
        assert len(ckan_erddap_links(catalogue)) == 2

    def test_empty_catalogue_returns_empty_frame_with_columns(self):
        links = ckan_erddap_links(pd.DataFrame())
        assert links.empty
        assert "ckan_title" in links.columns


class TestCkanObisLinks:
    def test_keys_on_the_obis_uuid(self, mocker):
        _make_ckan_get(mocker, [{"result": {"count": 2, "results": [
            _package(id="obis-rec", xml_location_url=f"https://x/{OBIS_UUID}.xml"),
            _package(id="erddap-rec", resources=[_tabledap("https://one.ca", "ds_a")]),
        ]}}], obis_records=["obis-rec"])
        links = ckan_obis_links(fetch_ckan_catalogue.fn())
        assert list(links["dataset_id"]) == [OBIS_UUID]
        assert list(links["ckan_eovs"]) == [["seaSurfaceTemperature"]]

    def test_empty_catalogue_returns_empty_frame_with_columns(self):
        links = ckan_obis_links(pd.DataFrame())
        assert links.empty
        assert "ckan_eovs" in links.columns


class TestFetchObisRecordIds:
    def test_returns_the_ids_the_harvest_source_produced(self, mocker):
        session = mocker.MagicMock()
        resp = mocker.MagicMock()
        resp.json.return_value = {
            "result": {"count": 2, "results": [{"id": "a"}, {"id": "b"}]}
        }
        session.get.return_value = resp
        assert fetch_obis_record_ids(session) == {"a", "b"}
        assert "harvest_source_title" in session.get.call_args[0][0]

    def test_absent_source_is_an_empty_set_not_an_error(self, mocker):
        """catalogue.cioos.ca returns count=0 for this source today."""
        session = mocker.MagicMock()
        resp = mocker.MagicMock()
        resp.json.return_value = {"result": {"count": 0, "results": []}}
        session.get.return_value = resp
        assert fetch_obis_record_ids(session) == frozenset()

    def test_a_failed_lookup_does_not_fail_the_harvest(self, mocker):
        # Without the OBIS link, OBIS datasets keep their own titles — which is
        # what they do anyway. Not worth failing a harvest over.
        session = mocker.MagicMock()
        session.get.side_effect = requests.ConnectionError("boom")
        assert fetch_obis_record_ids(session) == frozenset()
