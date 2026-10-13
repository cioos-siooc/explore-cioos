"""
Unit tests for cde_harvester.sources.ckan.create_ckan_erddap_link.

All outbound CKAN HTTP calls are intercepted with pytest-mock so the tests run
offline and deterministically.
"""


import pandas as pd
import pytest
import requests
from cde_harvester.core.errors import HASH_CKAN_UNAVAILABLE
from cde_harvester.sources.ckan.create_ckan_erddap_link import (
    erddap_join_key,
    get_ckan_records,
    split_erddap_url,
    unescape_ascii,
    unescape_ascii_list,
)
from cde_harvester.sources.ckan.create_ckan_obis_link import get_ckan_obis_records
from cde_harvester.sources.ckan.state import PREVIOUS_CKAN_COLUMNS, load_previous_ckan
from conftest import (
    CKAN_EMPTY_RESPONSE,
    CKAN_PACKAGE_SEARCH_RESPONSE,
    DATASET_ID,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ckan_get(mocker, pages):
    """
    Patch the CKAN session builder so session.get() yields the given page
    responses. CKAN fetching now goes through a requests.Session built by
    _build_ckan_session() rather than the module-level requests.get.
    Each call to list_ckan_records_with_erddap_urls paginates until results empty.
    """
    responses = []
    for page in pages:
        mock_resp = mocker.MagicMock()
        mock_resp.json.return_value = page
        responses.append(mock_resp)

    mock_session = mocker.MagicMock()
    mock_session.get.side_effect = responses
    mocker.patch(
        "cde_harvester.sources.ckan.create_ckan_erddap_link._build_ckan_session",
        return_value=mock_session,
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

    @pytest.mark.parametrize("suffix", [
        ".graph",
        ".nc?work_area%2Ccruise&cruise=~%22JS%22",
        ".html?longitude%2Clatitude",
        ".html#_gl=1*1i1894c",
        "",
    ])
    def test_extension_query_and_fragment_stripped(self, suffix):
        _, ds_id = split_erddap_url(
            f"https://erddap.ogsl.ca/erddap/tabledap/uqarIsmerCtdHypoxie{suffix}"
        )
        assert ds_id == "uqarIsmerCtdHypoxie"

    def test_griddap_url(self):
        host, ds_id = split_erddap_url(
            "https://erddap.ogsl.ca/erddap/griddap/cidcoBenthicSubstrateAiGodbout.graph"
        )
        assert host == "https://erddap.ogsl.ca"
        assert ds_id == "cidcoBenthicSubstrateAiGodbout"

    def test_missing_dataset_id_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid URL format"):
            split_erddap_url("https://erddap.ogsl.ca/erddap/tabledap/")

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


class TestErddapJoinKey:
    def test_scheme_case_and_trailing_slash_ignored(self):
        assert erddap_join_key("http://ERDDAP.amundsenscience.com/erddap/") == erddap_join_key(
            "https://erddap.amundsenscience.com/erddap"
        )


def _record(ckan_id, *urls):
    return {
        "id": ckan_id,
        "title_translated": {"en": f"{ckan_id} en", "fr": f"{ckan_id} fr"},
        "resources": [{"url": u} for u in urls],
    }


def _search_pages(*records):
    return [
        {"result": {"count": len(records), "results": list(records)}},
        CKAN_EMPTY_RESPONSE,
    ]


class TestGetCkanRecordsMatching:
    def test_queries_resource_urls(self, mocker):
        _make_ckan_get(mocker, [CKAN_PACKAGE_SEARCH_RESPONSE, CKAN_EMPTY_RESPONSE])
        get_ckan_records(None)
        from cde_harvester.sources.ckan import create_ckan_erddap_link as mod
        url = mod._build_ckan_session.return_value.get.call_args_list[0].args[0]
        assert "q=res_url%3A%2Aerddap%2A" in url

    def test_every_erddap_resource_in_a_record_is_kept(self, mocker):
        _make_ckan_get(mocker, _search_pages(_record(
            "multi",
            "https://erddap.ogsl.ca/erddap/tabledap/uqarIsmerCtdHypoxie.html",
            "https://catalogue.ogsl.ca/data/notes.pdf",
            "https://erddap.ogsl.ca/erddap/tabledap/uqarIsmerHypoxie2021Geochimie.html",
            "https://erddap.ogsl.ca/erddap/griddap/ecccShopNautilo.graph",
        )))
        df = get_ckan_records(None)
        assert sorted(df["dataset_id"]) == [
            "ecccShopNautilo", "uqarIsmerCtdHypoxie", "uqarIsmerHypoxie2021Geochimie",
        ]
        assert set(df["ckan_id"]) == {"multi"}

    def test_same_dataset_id_on_two_hosts_kept(self, mocker):
        _make_ckan_get(mocker, _search_pages(
            _record("a", "https://one.example.ca/erddap/tabledap/shared.html"),
            _record("b", "https://two.example.ca/erddap/tabledap/shared.html"),
        ))
        df = get_ckan_records(None)
        assert sorted(df["ckan_id"]) == ["a", "b"]

    def test_whole_dataset_record_preferred_over_subset(self, mocker):
        _make_ckan_get(mocker, _search_pages(
            _record("cruise", "https://erddap.ogsl.ca/erddap/tabledap/ismerSgdeCtd.html?cruiseID%2Ctime"),
            _record("umbrella", "https://erddap.ogsl.ca/erddap/tabledap/ismerSgdeCtd.html"),
        ))
        df = get_ckan_records(None)
        assert df["ckan_id"].tolist() == ["umbrella"]
        assert "is_subset" not in df.columns

    def test_unparseable_resource_skipped(self, mocker):
        _make_ckan_get(mocker, _search_pages(_record(
            "r",
            "https://example.ca/tabledap-notes.html",
            "https://erddap.ogsl.ca/erddap/tabledap/good.html",
        )))
        df = get_ckan_records(None)
        assert df["dataset_id"].tolist() == ["good"]

    def test_record_without_french_title_kept(self, mocker):
        record = _record("en-only", "https://erddap.ogsl.ca/erddap/tabledap/x.html")
        record["title_translated"] = {"en": "English only"}
        _make_ckan_get(mocker, _search_pages(record))
        df = get_ckan_records(None)
        assert df["ckan_title"].tolist() == ["English only"]
        assert df["title_fr"].isna().all()


class TestCkanUnavailable:
    def test_outage_returns_none(self, mocker):
        session = mocker.MagicMock()
        session.get.side_effect = requests.ConnectionError("down")
        mocker.patch(
            "cde_harvester.sources.ckan.create_ckan_erddap_link._build_ckan_session",
            return_value=session,
        )
        assert get_ckan_records([DATASET_ID]) is None

    def test_non_json_body_returns_none(self, mocker):
        resp = mocker.MagicMock()
        resp.json.side_effect = requests.exceptions.JSONDecodeError("x", "<html>", 0)
        resp.text = "<html>"
        session = mocker.MagicMock()
        session.get.return_value = resp
        mocker.patch(
            "cde_harvester.sources.ckan.create_ckan_erddap_link._build_ckan_session",
            return_value=session,
        )
        assert get_ckan_records([DATASET_ID]) is None

    def test_failed_obis_lookup_restored_from_stored_metadata(self, mocker):
        mocker.patch(
            "cde_harvester.sources.ckan.create_ckan_obis_link.requests.get",
            side_effect=requests.ConnectionError("down"),
        )
        load = mocker.patch(
            "cde_harvester.sources.ckan.create_ckan_obis_link.load_previous_ckan",
            return_value=pd.DataFrame([
                {"erddap_url": "https://obis.org", "dataset_id": d, "ckan_id": f"ckan-{d}",
                 "title": "Stored", "title_fr": "Stocké", "organizations": [], "eovs": ["fish"]}
                for d in ("uuid-1", "uuid-other")
            ]),
        )
        df = get_ckan_obis_records(["uuid-1", "uuid-2"], erddap_url="https://obis.org")
        load.assert_called_once_with(["https://obis.org"])
        assert df.to_dict("records") == [{
            "dataset_id": "uuid-1", "ckan_id": "ckan-uuid-1", "ckan_eovs": ["fish"],
            "ckan_title": "Stored", "title_fr": "Stocké",
        }]

    def test_stored_metadata_lookup_fails_open(self, mocker):
        mocker.patch(
            "cde_harvester.sources.ckan.state.create_db_engine",
            side_effect=RuntimeError("no db"),
        )
        df = load_previous_ckan(["https://obis.org"])
        assert df.empty
        assert list(df.columns) == PREVIOUS_CKAN_COLUMNS

    def test_failed_obis_lookup_not_cached(self, mocker, tmp_path):
        get = mocker.patch(
            "cde_harvester.sources.ckan.create_ckan_obis_link.requests.get",
            side_effect=requests.ConnectionError("down"),
        )
        assert get_ckan_obis_records(["uuid-1"], cache_folder=str(tmp_path)).empty
        assert list(tmp_path.iterdir()) == []

        found = mocker.MagicMock()
        found.json.return_value = {"result": {"results": [
            {"id": "ckan-1", "title_translated": {"en": "t", "fr": "f"}},
        ]}}
        get.side_effect = None
        get.return_value = found
        df = get_ckan_obis_records(["uuid-1"], cache_folder=str(tmp_path))
        assert df["ckan_id"].tolist() == ["ckan-1"]


class TestMergeCkanJoin:
    def _merge(self, mocker, tmp_path, ckan_erddap_url, ckan_available=True):
        from cde_harvester.__main__ import merge_and_write_csvs

        logger = mocker.MagicMock()
        mocker.patch("cde_harvester.__main__._run_logger", return_value=logger)
        erddap_datasets = pd.DataFrame({
            "erddap_url": ["https://erddap.amundsenscience.com/erddap"] * 2,
            "dataset_id": ["matched", "orphan"],
            "title": ["t1", "t2"],
            "organizations": [["org"], ["org"]],
            "content_hash": ["h1", "h2"],
            "content_hash_reason": [None, None],
        })
        df_ckan = pd.DataFrame({
            "erddap_url": [ckan_erddap_url],
            "dataset_id": ["matched"],
            "ckan_id": ["ckan-1"],
            "ckan_organizations": [["CKAN org"]],
            "ckan_title": ["CKAN title"],
            "title_fr": ["Titre"],
        })
        merge_and_write_csvs.fn(
            str(tmp_path), erddap_datasets,
            pd.DataFrame({"depth_min": [], "depth_max": []}), pd.DataFrame(),
            pd.DataFrame(), pd.DataFrame(), pd.DataFrame(),
            df_ckan if ckan_available else None,
        )
        return pd.read_csv(tmp_path / "datasets.csv").set_index("dataset_id"), logger

    def test_http_ckan_link_joins_https_server(self, mocker, tmp_path):
        datasets, _ = self._merge(mocker, tmp_path, "http://erddap.amundsenscience.com/erddap")
        assert datasets.loc["matched", "ckan_id"] == "ckan-1"
        assert datasets.loc["matched", "erddap_url"] == "https://erddap.amundsenscience.com/erddap"

    def test_unmatched_datasets_logged(self, mocker, tmp_path):
        _, logger = self._merge(mocker, tmp_path, "https://erddap.amundsenscience.com/erddap")
        message = logger.warning.call_args_list[0].args[0]
        assert message.startswith("1 ERDDAP datasets have no CKAN record")
        assert "https://erddap.amundsenscience.com/erddap/orphan" in message

    def test_ckan_outage_keeps_stored_metadata(self, mocker, tmp_path):
        load = mocker.patch(
            "cde_harvester.__main__.load_previous_ckan",
            return_value=pd.DataFrame([{
                "erddap_url": "https://erddap.amundsenscience.com/erddap",
                "dataset_id": "matched", "ckan_id": "ckan-1", "title": "Stored title",
                "title_fr": "Titre stocké", "organizations": ["Stored org"], "eovs": ["seaSurfaceTemperature"],
            }]),
        )
        datasets, logger = self._merge(
            mocker, tmp_path, "https://erddap.amundsenscience.com/erddap", ckan_available=False,
        )
        load.assert_called_once()
        matched = datasets.loc["matched"]
        assert (matched["ckan_id"], matched["title"], matched["title_fr"]) == (
            "ckan-1", "Stored title", "Titre stocké",
        )
        assert matched["organizations"] == "['Stored org']"
        assert matched["content_hash"] == "h1"
        assert logger.warning.call_args_list[0].args[0].startswith("CKAN unavailable")

    def test_ckan_outage_clears_hash_of_datasets_without_stored_link(self, mocker, tmp_path):
        mocker.patch(
            "cde_harvester.__main__.load_previous_ckan",
            return_value=pd.DataFrame(columns=PREVIOUS_CKAN_COLUMNS),
        )
        datasets, _ = self._merge(
            mocker, tmp_path, "https://erddap.amundsenscience.com/erddap", ckan_available=False,
        )
        assert datasets["ckan_id"].isna().all()
        assert datasets["title"].tolist() == ["t1", "t2"]
        assert datasets["content_hash"].isna().all()
        assert (datasets["content_hash_reason"] == HASH_CKAN_UNAVAILABLE).all()

    def test_hash_kept_when_ckan_available(self, mocker, tmp_path):
        datasets, _ = self._merge(mocker, tmp_path, "https://erddap.amundsenscience.com/erddap")
        assert datasets.loc["matched", "content_hash"] == "h1"
