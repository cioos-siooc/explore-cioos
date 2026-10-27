import csv
import io
import json
import re
import subprocess
import sys
import threading
import time
import tomllib
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch
from urllib.parse import quote, unquote

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import xarray as xr
from cioos_downloader import download_erddap, downloader_wrapper, formats, package, script

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
        patch("cioos_downloader.download_erddap.requests.get", side_effect=get),
        patch("cioos_downloader.download_erddap.save_source_metadata", return_value=list(metadata_warnings)),
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
    assert "cde_download_pkg001/data/Good_data_example_ca/Good_data_example_ca.csv" in names
    assert "cde_download_pkg001/data/Good_data_example_ca/citation.txt" in names
    assert "cde_download_pkg001/data/Good_data_example_ca/metadata/metadata.json" in names
    assert not any(n.startswith("cde_download_pkg001/data/Broken_data_example_ca/Broken") for n in names)
    assert not any(n.endswith("CITATION.cff") for n in names)

    readme = read("README.md")
    assert "1 of 2 datasets included" in readme
    assert "could not be retrieved from its source" in readme
    assert "disk on fire" in readme
    assert "seaSurfaceTemperature" in readme

    datapackage = json.loads(read("datapackage.json"))
    [data] = [r for r in datapackage["resources"] if not r["name"].startswith("readme")]
    assert data["path"] == "data/Good_data_example_ca/Good_data_example_ca.csv"
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
    [folder] = [e for e in crate["@graph"] if e["@id"] == "data/Good_data_example_ca/"]
    assert {"@id": "data/Good_data_example_ca/metadata/metadata.json"} in folder["hasPart"]

    citations = read("citation/citations.txt")
    assert citations.startswith("Hakai Institute (2021). CTD profiles. https://doi.org/10.1234/abc. Subset: time")
    assert "Retrieved " in citations and "Broken" not in citations
    assert "doi = {10.1234/abc}" in read("citation/citations.bib")
    assert "TY  - DATA" in read("citation/citations.ris")
    assert "https://creativecommons.org/licenses/by/4.0/" in read("citation/licences.txt")


def test_citation_falls_back_to_the_title_and_landing_page_without_metadata(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Bare")))
    assert read("data/Bare_data_example_ca/citation.txt").startswith(
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
    assert read("data/Big_data_example_ca/Big_data_example_ca.csv").endswith("5.0\n")


def test_over_the_query_limit_later_datasets_are_ignored_and_over_limit_is_set(tmp_path, monkeypatch):
    monkeypatch.setattr(download_erddap, "QUERY_SIZE_LIMIT", 1)
    monkeypatch.setattr(download_erddap, "MAX_WORKERS", 1)
    report, _, _ = _run(tmp_path, _query(_dataset("First"), _dataset("Second")))
    assert [r["status"] for r in report["erddap_report"]] == ["COMPLETED", "IGNORED"]
    assert report["over_limit"] is True


def test_obis_falls_back_to_csv_for_a_format_it_has_no_rendition_of(tmp_path, monkeypatch):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    report, archive, read = _run(tmp_path, _query(obis, format="nccf"))

    row = report["erddap_report"][0]
    assert row["format"] == "csv" and row["format_fallback"]
    assert "cde_download_pkg001/data/abc_obis_org/abc_obis_org.csv" in archive.namelist()
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



def test_a_date_only_range_keeps_the_whole_last_day(tmp_path):
    urls = []

    def get(url, **_):
        urls.append(unquote(url))
        return _response()

    _run(tmp_path, _query(_dataset("Days")), get)
    # erddapy sends times as epoch seconds: 2019-01-01T00:00:00Z and 2021-01-01T23:59:59Z.
    assert "time>=1546300800" in urls[0] and "time<=1609545599" in urls[0]


def test_variables_come_from_the_erddap_info_page_when_not_harvested(tmp_path):
    info = (
        "Row Type,Variable Name,Attribute Name,Data Type,Value\n"
        "attribute,NC_GLOBAL,title,String,T\n"
        "variable,time,,double,\n"
        "variable,temperature,,float,\n"
    )
    urls = []

    def get(url, **_):
        urls.append(unquote(url))
        return _response(text=info) if "/info/" in url else _response()

    _run(tmp_path, _query(_dataset("Unharvested", table_variables=None)), get)
    assert urls[0] == "https://data.example.ca/erddap/info/Unharvested/index.csv"
    assert "/tabledap/Unharvested.csv?time,temperature&" in urls[1]
    assert "depth>=" not in urls[1]


def test_the_download_script_builds_the_package_without_limits_or_the_html_readme(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(download_erddap, "DATASET_SIZE_LIMIT", 10)
    monkeypatch.chdir(tmp_path)
    query = _query(_dataset("Good", metadata=_METADATA))
    del query["user_query"]["email"]
    with (
        patch("cioos_downloader.download_erddap.requests.get", return_value=_response()),
        patch("cioos_downloader.download_erddap.save_source_metadata", return_value=[]),
    ):
        assert script.run(query) == 0
    assert "Good: COMPLETED, 1 file(s)" in capsys.readouterr().out

    root = tmp_path / "cde_download_pkg001"
    names = {p.relative_to(root).as_posix() for p in root.rglob("*")}
    assert (root / "data/Good_data_example_ca/Good_data_example_ca.csv").read_bytes() == _CSV
    assert {"README.md", "reproduce.py", "datapackage.json", "ro-crate-metadata.json"} <= names
    citation_files = {"citations.txt", "citations.bib", "citations.ris", "licences.txt"}
    assert {f"citation/{f}" for f in citation_files} <= names
    assert {"data/Good_data_example_ca/citation.txt", "data/Good_data_example_ca/metadata/metadata.json"} <= names
    assert "README.html" not in names
    assert "README.html" not in (root / "README.md").read_text()
    crate = (root / "ro-crate-metadata.json").read_text()
    assert "README.html" not in crate


def test_the_download_script_says_which_datasets_fell_back_to_csv(tmp_path, monkeypatch, capsys):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    monkeypatch.chdir(tmp_path)
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    with patch("cioos_downloader.download_erddap.save_source_metadata", return_value=[]):
        script.run(_query(obis, format="nccf"))

    assert "abc  was delivered as CSV: NetCDF CF (DSG) is not available for this source" in capsys.readouterr().out


def test_servers_download_concurrently_but_each_serves_one_request_at_a_time(tmp_path):
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

    assert peak == {"data.example.ca": 1, "other.example.ca": 1}
    assert [r["dataset_id"] for r in report["erddap_report"]] == [d["dataset_id"] for d in datasets]


def test_progress_hears_each_dataset_stage_bytes_and_outcome_in_order(tmp_path):
    events = []

    class Recorder(download_erddap.Progress):
        def stage(self, dataset, text):
            events.append((dataset["dataset_id"], "stage", text.split(":")[0]))

        def received(self, dataset, n_bytes):
            events.append((dataset["dataset_id"], "bytes", n_bytes))

        def finished(self, dataset, row):
            events.append((dataset["dataset_id"], "finished", row["status"]))

    with (
        patch("cioos_downloader.download_erddap.requests.get", return_value=_response()),
        patch("cioos_downloader.download_erddap.save_source_metadata", return_value=[]),
    ):
        download_erddap.get_datasets(_query(_dataset("A0"), _dataset("A1")), tmp_path, progress=Recorder())

    assert events == [
        (dataset_id, *event)
        for dataset_id in ("A0", "A1")
        for event in [
            ("stage", "fetching the source metadata records"),
            ("stage", "request 1/1"),
            ("bytes", len(_CSV)),
            ("stage", "writing CSV"),
            ("finished", "COMPLETED"),
        ]
    ]


# Inside: (-133, 50). Outside but within the bounding box: (-126, 55).
_TRIANGLE = "POLYGON((-135 48, -125 48, -135 56, -135 48))"
_POINTS = [(50.0, -133.0), (55.0, -126.0)]


def _raw_csv(path):
    path.write_text(
        "time,latitude,longitude,depth\nUTC,degrees_north,degrees_east,m\n"
        + "".join(f"2020-01-01T00:00:00Z,{lat},{lon},5.0\n" for lat, lon in _POINTS)
    )


def _raw_odv(path):
    path.write_text(
        "//<Creator>x</Creator>\n"
        "Cruise\tStation\tType\tyyyy-mm-ddThh:mm:ss.sss\tLongitude [degrees_east]\tLatitude [degrees_north]\n"
        + "".join(f"\t\t*\t2020-01-01T00:00:00.000Z\t{lon}\t{lat}\n" for lat, lon in _POINTS)
    )


def _raw_parquet(path):
    lats, lons = zip(*_POINTS, strict=True)
    table = pa.table({"latitude": lats, "longitude": lons}).replace_schema_metadata({"latitude_units": "degrees_north"})
    pq.write_table(table, path)


def _raw_nccf(path):
    lats, lons = zip(*_POINTS, strict=True)
    xr.Dataset(
        {
            "rowSize": ("profile", np.array([1, 1], dtype="int32"), {"sample_dimension": "obs"}),
            "latitude": ("profile", np.array(lats)),
            "longitude": ("profile", np.array(lons)),
            "depth": ("obs", np.array([5.0, 6.0])),
        },
        attrs={"featureType": "profile", "geospatial_lat_min": 50.0, "geospatial_lat_max": 55.0},
    ).to_netcdf(path)


_EMOF = "http://rs.iobis.org/obis/terms/ExtendedMeasurementOrFact"


def _struct(**columns):
    return pa.StructArray.from_arrays([pa.array(v) for v in columns.values()], names=list(columns))


def _raw_obis(path):
    """An OBIS export as published: OBIS's curated values, the provider's as
    submitted, quality flags and measurement records."""
    lats, lons = zip(*_POINTS, strict=True)
    interpreted = _struct(
        scientificName=["Gadus morhua"] * 2,
        decimalLatitude=list(lats),
        decimalLongitude=list(lons),
        date_start=[1577836800000] * 2,
        date_end=[1577836800000] * 2,
        minimumDepthInMeters=[5.0] * 2,
        maximumDepthInMeters=[5.0] * 2,
        eventDate=["2020-01-01"] * 2,
        occurrenceID=["occ-a", "occ-b"],
        aphiaid=[126436, 126436],
        cultivarEpithet=pa.array([None, None], pa.string()),
        areas=[[34, 35], [34]],
    )
    source = _struct(
        scientificName=["Gadus morhua Linnaeus, 1758"] * 2,
        decimalLatitude=[str(v) for v in lats],
        decimalLongitude=[str(v) for v in lons],
        eventDate=["2020-01-01T00:00Z"] * 2,
        occurrenceID=["occ-a", "occ-b"],
        cultivarEpithet=pa.array([None, None], pa.string()),
    )
    terms = ("measurementType", "measurementValue", "measurementUnit")
    measurement = pa.struct([("level", pa.int32()), ("source", pa.struct([(n, pa.string()) for n in terms]))])

    def fact(*values):
        return {"level": None, "source": dict(zip(terms, values, strict=True))}

    emof = pa.array(
        [[fact("length", "30", "cm"), fact("tow", "15", None), fact(None, None, None)], [fact("length", "41", "cm")]],
        pa.list_(measurement),
    )
    pq.write_table(
        pa.table(
            {
                "_id": ["a", "b"],
                "interpreted": interpreted,
                "source": source,
                "extensions": pa.StructArray.from_arrays([emof], names=[_EMOF]),
                "flags": [["NO_DEPTH"], []],
            }
        ),
        path,
    )


def _reproduce(tmp_path, archive, edit=None):
    archive.extractall(tmp_path / "unzipped")
    root = tmp_path / "unzipped" / "cde_download_pkg001"
    if edit:
        edit(root)
    result = subprocess.run([sys.executable, "reproduce.py"], cwd=root, capture_output=True, text=True)
    return root, result


def _point_requests_at(raw):
    def edit(root):
        datapackage = json.loads((root / "datapackage.json").read_text())
        for subset in datapackage["x-cde-subsets"]:
            subset["request_urls"] = [raw.as_uri()]
        (root / "datapackage.json").write_text(json.dumps(datapackage))

    return edit


@pytest.mark.parametrize(
    ("fmt", "write_raw"),
    [("csv", _raw_csv), ("odv", _raw_odv), ("parquet", _raw_parquet), ("nccf", _raw_nccf)],
)
def test_reproduce_rebuilds_every_erddap_format_identically(tmp_path, fmt, write_raw):
    raw = tmp_path / "raw"
    write_raw(raw)
    report, archive, _ = _run(
        tmp_path, _query(_dataset("Ctd"), format=fmt, polygon_region=_TRIANGLE),
        lambda url, **_: _response(body=raw.read_bytes()),
    )
    assert report["erddap_report"][0]["n_records"] == 1

    root, result = _reproduce(tmp_path, archive, _point_requests_at(raw))

    assert result.returncode == 0, result.stdout + result.stderr
    [data] = report["erddap_report"][0]["files"]
    assert f"match: {data['path']}" in result.stdout
    assert (root / "reproduced" / data["path"]).read_bytes() == (root / data["path"]).read_bytes()


@pytest.mark.parametrize(("fmt", "data"), [("csv", "csv"), ("parquet", "parquet"), ("dwca", "dwca.zip")])
def test_reproduce_rebuilds_obis_subsets_identically(tmp_path, monkeypatch, fmt, data):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    report, archive, _ = _run(tmp_path, _query(obis, format=fmt, polygon_region=_TRIANGLE))
    assert report["erddap_report"][0]["n_records"] == 1

    _, result = _reproduce(tmp_path, archive)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"match: data/abc_obis_org/abc_obis_org.{data}" in result.stdout
    assert "differs" not in result.stdout


def test_reproduce_reports_a_source_that_changed(tmp_path):
    raw = tmp_path / "raw"
    _raw_csv(raw)
    _, archive, _ = _run(
        tmp_path, _query(_dataset("Ctd"), polygon_region=_TRIANGLE), lambda url, **_: _response(body=raw.read_bytes())
    )
    raw.write_text(raw.read_text().replace("5.0", "7.0"))

    _, result = _reproduce(tmp_path, archive, _point_requests_at(raw))

    assert result.returncode == 1
    assert "differs: data/Ctd_data_example_ca/Ctd_data_example_ca.csv" in result.stdout


def _script_metadata(script):
    block = re.search(r"^# /// script\n((?:#.*\n)+?)^# ///$", script, re.MULTILINE).group(1)
    return tomllib.loads("".join(line.removeprefix("#").removeprefix(" ") + "\n" for line in block.splitlines()))


def test_reproduce_script_installs_the_downloader_that_built_the_package(tmp_path):
    url = "https://github.com/cioos-siooc/explore-cioos/archive/abc123.tar.gz#subdirectory=downloader"
    _, archive, read = _run(tmp_path, _query(_dataset("Ctd"), downloader_url=url))

    metadata = _script_metadata(read("reproduce.py"))
    assert metadata["dependencies"] == [f"cioos-data-explorer-downloader @ {url}"]
    created = json.loads(read("datapackage.json"))["created"]
    assert metadata["tool"]["uv"]["exclude-newer"] == created
    crate = json.loads(read("ro-crate-metadata.json"))
    assert "reproduce.py" in {e["@id"] for e in crate["@graph"] if e["@type"] == "File"}
    assert "uv run reproduce.py" in read("README.md")


def test_reproduce_script_of_an_older_job_tracks_the_development_branch(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Ctd")))

    assert _script_metadata(read("reproduce.py"))["dependencies"] == [
        f"cioos-data-explorer-downloader @ {package.DEFAULT_DOWNLOADER_URL}"
    ]


def test_obis_subsets_can_be_filtered_concurrently(tmp_path):
    # Datasets download on a thread pool; DuckDB's shared default connection
    # breaks when two OBIS queries overlap on it.
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    regions = formats.polygon_regions(_TRIANGLE)

    with ThreadPoolExecutor(max_workers=8) as pool:
        written = list(
            pool.map(lambda i: formats.write_obis("csv", str(export), {}, regions, tmp_path / str(i)), range(32))
        )

    assert [files[0]["n_rows"] for files in written] == [1] * 32


@pytest.mark.parametrize(
    ("query", "n_rows"),
    [
        ({}, 2),
        ({"depth_min": "6"}, 0),
        ({"depth_max": "4"}, 0),
        ({"depth_min": "5", "depth_max": "5"}, 2),
        ({"time_min": "2020-01-02"}, 0),
        ({"time_max": "2019-12-31T23:59:59Z"}, 0),
        ({"time_min": "2019-12-31T21:00:00-03:00", "time_max": "2020-01-01T00:00:00Z"}, 2),
    ],
)
def test_obis_occurrences_are_filtered_by_depth_and_time(tmp_path, query, n_rows):
    export = tmp_path / "export.parquet"
    _raw_obis(export)

    written = formats.write_obis("csv", str(export), query, [], tmp_path / "out")

    assert (written[0]["n_rows"] if written else 0) == n_rows


def _obis_run(tmp_path, monkeypatch, **user_query):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    return _run(tmp_path, _query(obis, polygon_region=_TRIANGLE, **user_query))


def _csv_rows(text, delimiter=","):
    return list(csv.DictReader(io.StringIO(text), delimiter=delimiter))


def test_obis_csv_holds_the_curated_darwin_core_fields_and_their_measurements(tmp_path, monkeypatch):
    report, archive, read = _obis_run(tmp_path, monkeypatch)

    [occurrence] = _csv_rows(read("data/abc_obis_org/abc_obis_org.csv"))
    # Named as in Darwin Core, with OBIS's own fields and flags; a field empty
    # across the whole dataset is left out.
    assert occurrence["decimalLatitude"] == "50.0" and occurrence["eventDate"] == "2020-01-01"
    assert occurrence["scientificName"] == "Gadus morhua"
    assert occurrence["aphiaid"] == "126436" and occurrence["areas"] == "34|35"
    assert occurrence["flags"] == "NO_DEPTH"
    assert "cultivarEpithet" not in occurrence
    measurements = _csv_rows(read("data/abc_obis_org/abc_obis_org_extendedmeasurementorfact.csv"))
    assert [(m["id"], m["measurementType"], m["measurementValue"]) for m in measurements] == [
        ("a", "length", "30"),
        ("a", "tow", "15"),
    ]
    assert report["erddap_report"][0]["n_records"] == 1
    assert "abc_obis_org_dnaderiveddata.csv" not in " ".join(archive.namelist())
    readme = read("README.md")
    assert "OBIS values: curated by OBIS" in readme
    assert "_extendedmeasurementorfact" in readme


def test_obis_values_can_be_as_the_provider_submitted_them(tmp_path, monkeypatch):
    _, _, read = _obis_run(tmp_path, monkeypatch, obis_values="submitted")

    [occurrence] = _csv_rows(read("data/abc_obis_org/abc_obis_org.csv"))
    assert occurrence["scientificName"] == "Gadus morhua Linnaeus, 1758"
    assert occurrence["eventDate"] == "2020-01-01T00:00Z"
    assert "aphiaid" not in occurrence and "flags" not in occurrence
    assert "as the provider submitted them" in read("README.md")


def test_obis_darwin_core_archive_maps_every_column_to_its_term(tmp_path, monkeypatch):
    _, archive, read = _obis_run(tmp_path, monkeypatch, format="dwca")

    path = "cde_download_pkg001/data/abc_obis_org/abc_obis_org.dwca.zip"
    dwca = zipfile.ZipFile(io.BytesIO(archive.read(path)))
    assert set(dwca.namelist()) == {"meta.xml", "occurrence.txt", "extendedmeasurementorfact.txt"}
    ns = {"dwc": "http://rs.tdwg.org/dwc/text/"}
    meta = ET.fromstring(dwca.read("meta.xml"))
    for table in [meta.find("dwc:core", ns), *meta.findall("dwc:extension", ns)]:
        location = table.find("dwc:files/dwc:location", ns).text
        header = dwca.read(location).decode().splitlines()[0].split("\t")
        terms = {int(f.get("index")): f.get("term") for f in table.findall("dwc:field", ns)}
        # Column 0 is the occurrence id; every other column is a mapped term.
        assert sorted(terms) == list(range(1, len(header)))
        assert all(terms[i].rsplit("/", 1)[1] == name for i, name in enumerate(header) if i)
    core = meta.find("dwc:core", ns)
    assert core.get("rowType") == "http://rs.tdwg.org/dwc/terms/Occurrence"
    [occurrence] = _csv_rows(dwca.read("occurrence.txt").decode(), "\t")
    # Only Darwin Core terms: OBIS's own fields stay in the CSV and Parquet tables.
    assert {"id", "scientificName", "eventDate", "occurrenceID"} <= set(occurrence)
    assert not {"aphiaid", "flags", "areas", "date_start"} & set(occurrence)
    resources = {r["path"]: r for r in json.loads(read("datapackage.json"))["resources"]}
    assert resources["data/abc_obis_org/abc_obis_org.dwca.zip"]["mediatype"] == "application/zip"
    assert "Darwin Core Archive" in read("README.md")


def test_the_darwin_core_archive_carries_the_eml_and_links_the_source_archive(tmp_path, monkeypatch):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    source_archive = "https://ipt.iobis.org/obiscanada/archive.do?r=abc"

    def save_source_metadata(dataset, folder):
        (folder / "eml.xml").write_text("<eml/>")
        (folder / "obis_dataset.json").write_text(json.dumps({"archive": source_archive}))
        return []

    monkeypatch.setattr(download_erddap, "save_source_metadata", save_source_metadata)
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    with patch("cioos_downloader.download_erddap.requests.get"):
        report = downloader_wrapper.run_download_query(
            download_query=_query(obis, format="dwca"), output_folder=tmp_path / "out"
        )
    archive = zipfile.ZipFile(report["path"])

    dwca = zipfile.ZipFile(io.BytesIO(archive.read("cde_download_pkg001/data/abc_obis_org/abc_obis_org.dwca.zip")))
    assert dwca.read("eml.xml") == b"<eml/>"
    assert b'metadata="eml.xml"' in dwca.read("meta.xml")
    readme = archive.read("cde_download_pkg001/README.md").decode()
    assert f"(<{source_archive}>)" in readme
    assert "OBIS occurrences without coordinates are not included" in readme


def _obis_readme(tmp_path, monkeypatch, eml_published):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))

    def save_source_metadata(dataset, folder):
        (folder / "eml.xml").write_text(
            '<eml:eml xmlns:eml="https://eml.ecoinformatics.org/eml-2.2.0" packageId="abc/v1.173">'
            f"<dataset><pubDate>{eml_published}</pubDate></dataset></eml:eml>"
        )
        (folder / "obis_dataset.json").write_text(json.dumps({"published": "2026-05-05T12:00:00.000Z"}))
        return []

    monkeypatch.setattr(download_erddap, "save_source_metadata", save_source_metadata)
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    with patch("cioos_downloader.download_erddap.requests.get"):
        report = downloader_wrapper.run_download_query(download_query=_query(obis), output_folder=tmp_path / "out")
    return zipfile.ZipFile(report["path"]).read("cde_download_pkg001/README.md").decode()


def test_the_readme_dates_the_obis_version_and_flags_a_newer_one_from_the_provider(tmp_path, monkeypatch):
    readme = _obis_readme(tmp_path, monkeypatch, "2026-10-05")

    assert "OBIS's copy, used for these data, is the version published 2026-05-05" in readme
    assert "the provider has since published a newer one (v1.173, 2026-10-05)" in readme


def test_the_readme_flags_no_newer_version_when_obis_has_the_latest(tmp_path, monkeypatch):
    readme = _obis_readme(tmp_path, monkeypatch, "2026-05-05")

    assert "the version published 2026-05-05." in readme
    assert "has since published" not in readme


def test_erddap_datasets_fall_back_to_csv_from_a_darwin_core_archive(tmp_path):
    report, archive, read = _run(tmp_path, _query(_dataset("Ctd"), format="dwca"))

    row = report["erddap_report"][0]
    assert row["format"] == "csv" and row["format_fallback"]
    assert "cde_download_pkg001/data/Ctd_data_example_ca/Ctd_data_example_ca.csv" in archive.namelist()
    assert "was delivered as CSV: Darwin Core Archive is not available" in read("README.md")


def test_the_readme_also_ships_as_a_standalone_web_page(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=_METADATA)))

    html = read("README.html")
    assert html.startswith("<!doctype html>") and '<html lang="en">' in html
    assert "<title>CIOOS Data Explorer download pkg001</title>" in html
    assert "<h1>CIOOS Data Explorer download pkg001</h1>" in html
    assert "<table>" in html and '<a href="data/Good_data_example_ca/">' in html
    assert 'src="data:image/svg+xml;base64,' in html
    # Opened offline from disk: no stylesheet, script, image or font is fetched.
    assert not re.search(r'<link\b|<script[^>]*\ssrc=|src="https?:|url\(', html)
    assert "[`data/Good_data_example_ca/`](data/Good_data_example_ca/)" in read("README.md")
    names = {r["path"] for r in json.loads(read("datapackage.json"))["resources"]}
    assert "README.html" in names
    crate = json.loads(read("ro-crate-metadata.json"))
    assert "README.html" in {e["@id"] for e in crate["@graph"] if e["@type"] == "File"}


def test_source_text_cannot_inject_html_into_the_readme_page(tmp_path):
    def get(url, **_):
        return _response(500, text='Error {\n    message="<img src=x onerror=alert(2)>";\n}')

    _, _, read = _run(tmp_path, _query(_dataset("Bad", title="<script>alert(1)</script>")), get)

    html = read("README.html")
    assert "<script>alert(1)" not in html and "<img src=x" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html


def test_each_dataset_links_to_its_source_records(tmp_path):
    erddap = _dataset("Good", metadata=_METADATA, ckan_url="https://catalogue.cioos.ca/dataset/abc")
    _, _, read = _run(tmp_path, _query(erddap, language="fr"))

    readme = read("README.md")
    docs = readme[readme.index("## Documentation") : readme.index("## Reproduire")]
    assert "- **Title Good**: [`metadata/`](data/Good_data_example_ca/metadata/) · " in docs
    assert (
        "[ERDDAP](<https://data.example.ca/erddap/info/Good/index.html>) · "
        "[Catalogue SIOOC](<https://catalogue.cioos.ca/dataset/abc>) · "
        "[DOI](<https://doi.org/10.1234/abc>)"
    ) in docs
    assert '<a href="https://catalogue.cioos.ca/dataset/abc">Catalogue SIOOC</a>' in read("README.html")


def test_an_obis_dataset_links_to_its_obis_page(tmp_path, monkeypatch):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    _, _, read = _run(tmp_path, _query(obis))

    assert "[OBIS](<https://obis.org/dataset/abc>)" in read("README.md")


def test_harvested_citations_are_cleaned_into_one_sentence(tmp_path):
    metadata = {"citation": {"en": "Centre for Ocean Ventures &amp; Entrepreneurship (2026).\n  Halifax  Buoy. https://x.ca/d?local=en"}}
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=metadata)))

    assert read("data/Good_data_example_ca/citation.txt").startswith(
        "Centre for Ocean Ventures & Entrepreneurship (2026). Halifax Buoy. https://x.ca/d?local=en. Subset:"
    )


def test_readme_citations_link_the_request_instead_of_printing_it(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=_METADATA)))

    readme = read("README.md")
    cite = readme[readme.index("## How to cite") : readme.index("## Documentation")]
    assert "### Title Good" in cite
    assert "> Hakai Institute (2021). CTD profiles. <https://doi.org/10.1234/abc>" in cite
    assert re.search(r"- Retrieved: \d{4}-\d\d-\d\d \d\d:\d\d UTC", cite)
    assert "- Request: [data.example.ca](<https://data.example.ca/erddap/tabledap/Good.csv?" in cite
    assert (
        "- Citation to copy: [`data/Good_data_example_ca/citation.txt`](data/Good_data_example_ca/citation.txt)"
    ) in cite
    # The request URL appears only as a link target, never as visible text.
    assert cite.count("tabledap/Good.csv") == 1

    html = read("README.html")
    assert '<blockquote>\n<p>Hakai Institute (2021). CTD profiles. <a href="https://doi.org/10.1234/abc">' in html
    assert ">data.example.ca</a>" in html


def test_readme_numbers_the_requests_of_a_split_subset(tmp_path):
    ids = [f"station_{i:04d}_{'x' * 40}" for i in range(400)]
    dataset = _dataset("Ctd", cdm_data_type="TimeSeries", feature_id_variable="station", feature_ids=ids)
    report, _, read = _run(tmp_path, _query(dataset))

    n = len(report["erddap_report"][0]["download_url_list"])
    assert n > 1
    assert "- Request: [1](<https://" in read("README.md") and f" · [{n}](<https://" in read("README.md")


def _embedded_citations(html):
    return json.loads(re.search(r'<script type="application/json" id="citations">(.*?)</script>', html, re.S).group(1))


def test_the_readme_page_embeds_each_full_citation_for_its_copy_button(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=_METADATA), language="fr"))

    html = read("README.html")
    citation = read("data/Good_data_example_ca/citation.txt").strip()
    assert _embedded_citations(html) == {"data/Good_data_example_ca": citation}
    assert 'title = "Copier la citation"' in html and '<span class="sr-only">Copié</span>' in html


def test_citation_text_cannot_close_the_embedded_script(tmp_path):
    metadata = {"citation": {"en": "Evil (2026). </script><script>alert(3)</script>"}}
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=metadata)))

    html = read("README.html")
    assert "<script>alert(3)" not in html
    assert "</script><script>alert(3)" in _embedded_citations(html)["data/Good_data_example_ca"]


def test_the_readme_data_table_links_each_folder_and_names_its_licence(tmp_path):
    bare = _dataset("Bare")
    worded = _dataset("Worded", metadata={"license": {"title": "This work is licensed  under a CC&amp;BY licence"}})
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=_METADATA), worded, bare))

    readme = read("README.md")
    data = readme[readme.index("## Data") : readme.index("## Your selection")]
    assert "| Dataset | Rows | Folder | Licence |" in data
    good = "[`data/Good_data_example_ca/`](data/Good_data_example_ca/)"
    assert f"| Title Good | 1 | {good} | [CC-BY-4.0](<https://creativecommons.org/licenses/by/4.0/>) |" in data
    assert "| This work is licensed under a CC&BY licence |" in data
    assert "| *no licence recorded; check the source* |" in data
    assert "This work is licensed under a CC&BY licence" in read("citation/licences.txt")


@pytest.mark.parametrize(
    ("language", "label", "section", "anchor"),
    [("en", "On this page:", "Data", "data"), ("fr", "Sur cette page :", "Données", "données")],
)
def test_the_readme_opens_with_a_table_of_contents(tmp_path, language, label, section, anchor):
    _, _, read = _run(tmp_path, _query(_dataset("Good"), language=language))

    readme = read("README.md")
    assert readme.index(label) < readme.index("## ")
    assert f"- [{section}](#{anchor})" in readme
    html = read("README.html")
    assert f'<h2 id="{anchor}">{section}</h2>' in html
    nav = html[html.index('<nav class="toc-nav"'):html.index("</nav>")]
    # markdown-it percent-encodes the link; browsers decode it to match the id.
    assert f'aria-label="{label.rstrip(" :")}"' in nav and f'href="#{quote(anchor)}"' in nav
    # Beside the body, not inside it.
    assert label not in html[html.index("<main>"):]


def test_the_readme_links_back_to_the_selection_in_the_explorer(tmp_path):
    url = "https://explore.cioos.ca/?eovs=seaSurfaceTemperature&polygon=%5B%5B-65%2C44%5D%5D&lang=en"
    _, _, read = _run(tmp_path, _query(_dataset("Good"), explorer_url=url))

    assert f"[Open this selection in the CIOOS Data Explorer](<{url}>)" in read("README.md")
    assert f'<a href="{url.replace("&", "&amp;")}">Open this selection' in read("README.html")


def test_a_job_queued_before_explorer_links_still_builds_its_readme(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Good")))
    assert "Open this selection" not in read("README.md")


@pytest.mark.parametrize(
    ("language", "opening", "data", "about"),
    [
        ("en", "The data you selected", "## Data", "## About this package"),
        ("fr", "Les données que vous avez sélectionnées", "## Données", "## À propos de ce paquet"),
    ],
)
def test_the_readme_leads_with_the_data_and_ends_with_where_it_came_from(tmp_path, language, opening, data, about):
    _, _, read = _run(tmp_path, _query(_dataset("Good"), language=language))

    readme = read("README.md")
    sections = [line for line in readme.splitlines() if line.startswith("## ")]
    assert readme.index(opening) < readme.index("## ")
    assert sections[0] == data and sections[-1] == about
    about_text = readme[readme.index(about) :]
    assert "OBIS" in about_text and "ERDDAP" in about_text


def test_the_readme_explains_each_file_and_how_to_open_the_formats_it_holds(tmp_path, monkeypatch):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    _, _, read = _run(tmp_path, _query(obis, format="parquet"))

    readme = read("README.md")
    files = readme[readme.index("## Files in this package") : readme.index("## Your selection")]
    assert "`pandas.read_parquet`" in files and "`pandas.read_csv`" not in files
    for name in ("citation.txt", "metadata.json", "citations.bib", "licences.txt", "datapackage.json", "reproduce.py"):
        assert f"`{name}`" in files
    assert "(#reproduce-this-download)" in files
    assert "[Files in this package](#files-in-this-package)" in readme[: readme.index("## Files in this package")]
