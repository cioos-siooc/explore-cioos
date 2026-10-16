import json
import threading
import time
import zipfile
from unittest.mock import MagicMock, patch
from urllib.parse import unquote

import pandas as pd
import pytest
from erddap_downloader import download_erddap, downloader_wrapper

_CSV = (
    b"time,latitude,longitude,depth\n"
    b"UTC,degrees_north,degrees_east,m\n"
    b"2020-01-01T00:00:00Z,52.0,-130.0,5.0\n"
)
_VARIABLES = [{"name": n} for n in ("time", "latitude", "longitude", "depth")]
_METADATA = {
    "citation": {"en": "Hakai Institute (2021). CTD profiles. https://doi.org/10.1234/abc"},
    "doi": "https://doi.org/10.1234/abc",
    "license": {"title": "CC-BY-4.0", "url": "https://creativecommons.org/licenses/by/4.0/"},
}


def _response(status=200, body=_CSV, text=""):
    resp = MagicMock()
    resp.status_code = status
    resp.reason = "Internal Server Error" if status == 500 else "OK"
    resp.text = text
    resp.iter_content = MagicMock(return_value=[body])
    resp.__enter__ = lambda s: s
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def _dataset(dataset_id, **extra):
    return {
        "erddap_url": "https://data.example.ca/erddap",
        "dataset_id": dataset_id,
        "title": f"Title {dataset_id}",
        "cdm_data_type": "Profile",
        "source_type": "erddap",
        "ckan_id": None,
        "table_variables": _VARIABLES,
        **extra,
    }


def _query(*datasets, **user_query):
    return {
        "user_query": {
            "language": "en",
            "time_min": "2019-01-01",
            "time_max": "2021-01-01",
            "lat_min": 48.0,
            "lat_max": 56.0,
            "lon_min": -135.0,
            "lon_max": -125.0,
            "depth_min": 0,
            "depth_max": 100,
            "polygon_region": None,
            "email": "diver@example.com",
            "job_id": "pkg001",
            "format": "csv",
            "filters": {"eovs": "seaSurfaceTemperature"},
            **user_query,
        },
        "cache_filtered": list(datasets),
    }


def _run(tmp_path, query, get=None, metadata_warnings=()):
    get = get or (lambda url, **_: _response())
    with (
        patch("erddap_downloader.download_erddap.requests.get", side_effect=get),
        patch("erddap_downloader.download_erddap.save_source_metadata", return_value=list(metadata_warnings)),
    ):
        report = downloader_wrapper.run_download_query(download_query=query, output_folder=tmp_path / "out")
    archive = zipfile.ZipFile(report["path"])
    root = "cde_download_pkg001/"

    def read(name):
        return archive.read(root + name).decode()

    return report, archive, read


def test_a_failed_dataset_is_reported_and_the_rest_ship(tmp_path):
    def get(url, **_):
        if "Broken" in url:
            return _response(500, text='Error {\n    code=500;\n    message="Internal: disk on fire";\n}')
        return _response()

    query = _query(_dataset("Good", metadata=_METADATA), _dataset("Broken"))
    report, archive, read = _run(tmp_path, query, get)

    rows = {r["dataset_id"]: r for r in report["erddap_report"]}
    assert rows["Good"]["status"] == "COMPLETED"
    assert rows["Broken"]["status"] == "FAILED"
    assert "disk on fire" in rows["Broken"]["erddap_error"]

    names = set(archive.namelist())
    assert "cde_download_pkg001/Good_data_example_ca/Good_data_example_ca.csv" in names
    assert "cde_download_pkg001/Good_data_example_ca/citation.txt" in names
    assert "cde_download_pkg001/Good_data_example_ca/metadata.json" in names
    assert not any(n.startswith("cde_download_pkg001/Broken_data_example_ca/Broken") for n in names)

    readme = read("README.md")
    assert "1 of 2 datasets included" in readme
    assert "could not be retrieved from its source" in readme
    assert "disk on fire" in readme
    assert "seaSurfaceTemperature" in readme

    datapackage = json.loads(read("datapackage.json"))
    [data] = [r for r in datapackage["resources"] if r["name"] != "readme"]
    assert data["path"] == "Good_data_example_ca/Good_data_example_ca.csv"
    assert data["hash"].startswith("sha256:") and data["bytes"] > 0
    assert data["dialect"] == {"commentRows": [2]}
    assert data["licenses"] == [{"path": "https://creativecommons.org/licenses/by/4.0/", "title": "CC-BY-4.0"}]
    assert unquote(data["sources"][0]["path"]).startswith("https://data.example.ca/erddap/tabledap/Good.csv")
    assert [f["dataset_id"] for f in datapackage["x-cde-failed"]] == ["Broken"]
    assert "email" not in datapackage["x-cde-query"]

    crate = json.loads(read("ro-crate-metadata.json"))
    actions = {e["name"]: e for e in crate["@graph"] if e["@type"] == "CreateAction"}
    assert actions["Subset of Title Broken"]["actionStatus"]["@id"].endswith("FailedActionStatus")
    assert "disk on fire" in actions["Subset of Title Broken"]["error"]
    assert actions["Subset of Title Good"]["result"] == {"@id": data["path"]}

    citations = read("citations.txt")
    assert citations.startswith("Hakai Institute (2021). CTD profiles. https://doi.org/10.1234/abc Subset: time")
    assert "Retrieved " in citations and "Broken" not in citations
    assert "doi = {10.1234/abc}" in read("citations.bib")
    assert "TY  - DATA" in read("citations.ris")
    assert 'doi: "10.1234/abc"' in read("CITATION.cff")
    assert "https://creativecommons.org/licenses/by/4.0/" in read("rights.txt")


def test_citation_falls_back_to_the_title_and_landing_page_without_metadata(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Bare")))
    assert read("Bare_data_example_ca/citation.txt").startswith(
        "Title Bare. https://data.example.ca/erddap/info/Bare/index.html. Subset:"
    )


def test_an_empty_download_still_ships_the_readme(tmp_path):
    no_rows = 'Error {\n    message="Not Found: Your query produced no matching results. (nRows = 0)";\n}'
    report, archive, read = _run(tmp_path, _query(_dataset("Nothing")), lambda url, **_: _response(404, text=no_rows))

    assert report["empty_download"] is True
    assert report["erddap_report"][0]["status"] == "EMPTY"
    assert "0 of 1 datasets included" in read("README.md")
    assert json.loads(read("datapackage.json"))["resources"][0]["name"] == "readme"


def test_an_unknown_dataset_id_is_a_failure_not_an_empty_result(tmp_path):
    unknown = 'Error {\n    code=404;\n    message="Not Found: Currently unknown datasetID=Gone";\n}'
    report, _, read = _run(tmp_path, _query(_dataset("Gone")), lambda url, **_: _response(404, text=unknown))

    assert report["erddap_report"][0]["status"] == "FAILED"
    assert "Currently unknown datasetID=Gone" in read("README.md")


def test_a_metadata_fetch_failure_is_a_warning_not_a_failure(tmp_path):
    report, _, read = _run(tmp_path, _query(_dataset("Good")), metadata_warnings=["CKAN metadata record unavailable"])
    assert report["erddap_report"][0]["status"] == "COMPLETED"
    assert "CKAN metadata record unavailable" in read("README.md")


def test_a_binary_format_over_the_dataset_limit_fails_instead_of_shipping_truncated(tmp_path, monkeypatch):
    monkeypatch.setattr(download_erddap, "DATASET_SIZE_LIMIT", 10)
    report, _, _ = _run(tmp_path, _query(_dataset("Huge"), format="parquet"))
    row = report["erddap_report"][0]
    assert row["status"] == "FAILED"
    assert row["reason_code"] == "DATASET_SIZE_LIMIT"


def test_a_text_format_over_the_dataset_limit_ships_whole_lines_as_partial(tmp_path, monkeypatch):
    monkeypatch.setattr(download_erddap, "DATASET_SIZE_LIMIT", len(_CSV) + 5)
    body = _CSV + b"2020-01-02T00:00:00Z,52.0,-130.0,6.0\n"
    report, _, read = _run(tmp_path, _query(_dataset("Big")), lambda url, **_: _response(body=body))
    row = report["erddap_report"][0]
    assert row["status"] == "PARTIAL"
    assert read("Big_data_example_ca/Big_data_example_ca.csv").endswith("5.0\n")


def test_over_the_query_limit_later_datasets_are_ignored_and_over_limit_is_set(tmp_path, monkeypatch):
    monkeypatch.setattr(download_erddap, "QUERY_SIZE_LIMIT", 1)
    monkeypatch.setattr(download_erddap, "MAX_WORKERS", 1)
    report, _, _ = _run(tmp_path, _query(_dataset("First"), _dataset("Second")))
    assert [r["status"] for r in report["erddap_report"]] == ["COMPLETED", "IGNORED"]
    assert report["over_limit"] is True


def test_obis_falls_back_to_csv_for_a_format_it_has_no_rendition_of(tmp_path):
    df = pd.DataFrame({"id": ["a"], "scientificName": ["Gadus morhua"], "latitude": [52.0], "longitude": [-130.0],
                       "date_start": [1577836800000], "date_end": [1577836800000],
                       "minimumDepthInMeters": [5.0], "maximumDepthInMeters": [5.0]})
    duck = MagicMock()
    duck.df.return_value = df
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    with patch("duckdb.sql", return_value=duck):
        report, archive, read = _run(tmp_path, _query(obis, format="nccf"))

    row = report["erddap_report"][0]
    assert row["format"] == "csv" and row["format_fallback"]
    assert "cde_download_pkg001/abc_obis_org/abc_obis_org.csv" in archive.namelist()
    assert "was delivered as CSV" in read("README.md")


def test_feature_ids_replace_the_bounding_box(tmp_path):
    urls = []

    def get(url, **_):
        urls.append(unquote(url))
        return _response()

    dataset = _dataset("Prof", feature_id_variable="profile", feature_ids=["2015-015-0107", "a.b"])
    _run(tmp_path, _query(dataset, polygon_region="POLYGON((-131 51,-129 51,-129 53,-131 53,-131 51))"), get)

    [url] = urls
    assert 'profile=~"(2015[-]015[-]0107|a[.]b)"' in url
    assert "latitude>=" not in url


def test_feature_ids_are_split_to_keep_urls_short(monkeypatch):
    monkeypatch.setattr(download_erddap, "URL_BUDGET", 40)
    constraints = download_erddap.feature_constraints(
        {"feature_id_variable": "station", "feature_ids": [f"station{i:02d}" for i in range(6)]}
    )
    assert len(constraints) > 1
    joined = "|".join(c["station=~"].strip("()") for c in constraints)
    assert joined.split("|") == [f"station{i:02d}" for i in range(6)]


@pytest.mark.parametrize(
    "dataset",
    [
        {"feature_id_variable": "station", "feature_ids": ['bad"quote']},
        {"feature_id_variable": None, "feature_ids": ["a"]},
        {"feature_id_variable": "station", "feature_ids": None},
    ],
)
def test_feature_ids_fall_back_to_a_box_when_unusable(dataset):
    assert download_erddap.feature_constraints(dataset) is None


def test_a_box_is_sent_even_without_a_polygon(tmp_path):
    urls = []

    def get(url, **_):
        urls.append(unquote(url))
        return _response()

    _run(tmp_path, _query(_dataset("Boxed")), get)
    assert "latitude>=48.0" in urls[0] and "longitude<=-125.0" in urls[0]


def test_downloads_run_concurrently_but_at_most_two_per_server(tmp_path):
    active, peak, lock = {}, {}, threading.Lock()

    def get(url, **_):
        host = url.split("/")[2]
        with lock:
            active[host] = active.get(host, 0) + 1
            peak[host] = max(peak.get(host, 0), active[host])
        time.sleep(0.05)
        with lock:
            active[host] -= 1
        return _response()

    datasets = [_dataset(f"A{i}") for i in range(4)] + [
        _dataset(f"B{i}", erddap_url="https://other.example.ca/erddap") for i in range(4)
    ]
    report, _, _ = _run(tmp_path, _query(*datasets), get)

    assert peak == {"data.example.ca": 2, "other.example.ca": 2}
    assert [r["dataset_id"] for r in report["erddap_report"]] == [d["dataset_id"] for d in datasets]
