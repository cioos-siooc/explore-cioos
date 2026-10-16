import json
import re
import shutil
import subprocess
import sys
import threading
import time
import tomllib
import zipfile
from importlib.metadata import version
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import unquote

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import xarray as xr
from erddap_downloader import download_erddap, downloader_wrapper, formats, package

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


def _run(tmp_path, query, get=None, metadata_warnings=(), lock=None):
    get = get or (lambda url, **_: _response())
    with (
        patch("erddap_downloader.download_erddap.requests.get", side_effect=get),
        patch("erddap_downloader.download_erddap.save_source_metadata", return_value=list(metadata_warnings)),
        # Never a lock left in the checkout by a local build_reproduce_lock().
        patch.object(package, "REPRODUCE_LOCK", lock or tmp_path / "no.lock"),
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


def _raw_obis(path):
    lats, lons = zip(*_POINTS, strict=True)
    interpreted = pa.StructArray.from_arrays(
        [
            pa.array(["Gadus morhua"] * 2),
            pa.array(lats),
            pa.array(lons),
            pa.array([1577836800000] * 2),
            pa.array([1577836800000] * 2),
            pa.array([5.0] * 2),
            pa.array([5.0] * 2),
        ],
        names=["scientificName", "decimalLatitude", "decimalLongitude", "date_start", "date_end",
               "minimumDepthInMeters", "maximumDepthInMeters"],
    )
    pq.write_table(pa.table({"_id": ["a", "b"], "interpreted": interpreted}), path)


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


@pytest.mark.parametrize("fmt", ["csv", "parquet"])
def test_reproduce_rebuilds_obis_subsets_identically(tmp_path, monkeypatch, fmt):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    report, archive, _ = _run(tmp_path, _query(obis, format=fmt, polygon_region=_TRIANGLE))
    assert report["erddap_report"][0]["n_records"] == 1

    _, result = _reproduce(tmp_path, archive)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"match: abc_obis_org/abc_obis_org.{fmt}" in result.stdout


def test_reproduce_reports_a_source_that_changed(tmp_path):
    raw = tmp_path / "raw"
    _raw_csv(raw)
    _, archive, _ = _run(
        tmp_path, _query(_dataset("Ctd"), polygon_region=_TRIANGLE), lambda url, **_: _response(body=raw.read_bytes())
    )
    raw.write_text(raw.read_text().replace("5.0", "7.0"))

    _, result = _reproduce(tmp_path, archive, _point_requests_at(raw))

    assert result.returncode == 1
    assert "differs: Ctd_data_example_ca/Ctd_data_example_ca.csv" in result.stdout


def test_reproduce_script_pins_the_versions_that_built_the_package(tmp_path):
    _, archive, read = _run(tmp_path, _query(_dataset("Ctd")))

    assert read("formats.py") == Path(formats.__file__).read_text()
    block = re.search(r"^# /// script\n((?:#.*\n)+?)^# ///$", read("reproduce.py"), re.MULTILINE).group(1)
    metadata = tomllib.loads("".join(line.removeprefix("#").removeprefix(" ") + "\n" for line in block.splitlines()))
    assert f"pandas=={version('pandas')}" in metadata["dependencies"]
    assert all("==" in d for d in metadata["dependencies"])
    assert metadata["requires-python"] == f"=={sys.version_info.major}.{sys.version_info.minor}.*"
    crate = json.loads(read("ro-crate-metadata.json"))
    assert {"reproduce.py", "formats.py"} <= {e["@id"] for e in crate["@graph"] if e["@type"] == "File"}


_PYTHON = f"=={sys.version_info.major}.{sys.version_info.minor}.*"


def _lock(path, pins, python):
    requirements = "\n".join(f'    {{ name = "{n}", specifier = "{p}" }},' for n, p in pins.items())
    path.write_text(f'version = 1\nrequires-python = "{python}"\n\n[manifest]\nrequirements = [\n{requirements}\n]\n')
    return path


def _current_pins():
    return {name: f"=={version(name)}" for name in package.REPRODUCE_DEPENDENCIES}


def test_the_build_time_lock_ships_with_the_reproduce_script(tmp_path):
    lock = _lock(tmp_path / "reproduce.py.lock", _current_pins(), _PYTHON)
    _, archive, read = _run(tmp_path, _query(_dataset("Ctd")), lock=lock)

    assert read("reproduce.py.lock") == lock.read_text()
    crate = json.loads(read("ro-crate-metadata.json"))
    assert "reproduce.py.lock" in {e["@id"] for e in crate["@graph"] if e["@type"] == "File"}
    assert "uv run reproduce.py" in read("README.md")


@pytest.mark.parametrize(
    ("pins", "python"),
    [
        ({**_current_pins(), "pandas": "==1.0.0"}, _PYTHON),
        ({"pandas": _current_pins()["pandas"]}, _PYTHON),
        (_current_pins(), "==3.12.*"),
    ],
    ids=["other version", "missing package", "other python"],
)
def test_a_lock_made_for_other_pins_is_not_shipped(tmp_path, pins, python):
    lock = _lock(tmp_path / "reproduce.py.lock", pins, python)
    report, archive, read = _run(tmp_path, _query(_dataset("Ctd")), lock=lock)

    assert report["erddap_report"][0]["status"] == "COMPLETED"
    assert "cde_download_pkg001/reproduce.py.lock" not in archive.namelist()
    assert "reproduce.py.lock" not in {e["@id"] for e in json.loads(read("ro-crate-metadata.json"))["@graph"]}


def test_build_reproduce_lock_locks_the_shipped_header(tmp_path, monkeypatch):
    monkeypatch.setattr(package, "REPRODUCE_LOCK", tmp_path / "reproduce.py.lock")
    locked = []

    def uv_lock(command, **_):
        script = Path(command[-1])
        locked.append(script.read_text())
        _lock(script.with_name("reproduce.py.lock"), _current_pins(), _PYTHON)

    with patch("erddap_downloader.package.subprocess.run", side_effect=uv_lock):
        package.build_reproduce_lock()

    assert locked == [package._reproduce_script()]
    assert package._current_lock() == tmp_path / "reproduce.py.lock"


def test_reproduce_without_uv_says_to_use_uv(tmp_path):
    shutil.copyfile(package.REPRODUCE_SCRIPT, tmp_path / "reproduce.py")

    result = subprocess.run([sys.executable, "-I", "reproduce.py"], cwd=tmp_path, capture_output=True, text=True)

    assert result.returncode == 1
    assert "uv run reproduce.py" in result.stderr
