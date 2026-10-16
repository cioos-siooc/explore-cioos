import json
import re
import subprocess
import sys
import threading
import time
import tomllib
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import quote, unquote

import numpy as np
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
    [data] = [r for r in datapackage["resources"] if not r["name"].startswith("readme")]
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
    assert citations.startswith("Hakai Institute (2021). CTD profiles. https://doi.org/10.1234/abc. Subset: time")
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


def test_obis_falls_back_to_csv_for_a_format_it_has_no_rendition_of(tmp_path, monkeypatch):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
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


def test_reproduce_script_pins_the_versions_of_its_lock(tmp_path):
    _, archive, read = _run(tmp_path, _query(_dataset("Ctd")))

    script = read("reproduce.py")
    assert script.endswith(Path(formats.__file__).read_text())
    block = re.search(r"^# /// script\n((?:#.*\n)+?)^# ///$", script, re.MULTILINE).group(1)
    metadata = tomllib.loads("".join(line.removeprefix("#").removeprefix(" ") + "\n" for line in block.splitlines()))
    lock = tomllib.loads(read("reproduce.py.lock"))
    assert read("reproduce.py.lock") == package.REPRODUCE_LOCK.read_text()
    assert metadata["dependencies"] == [f"{r['name']}{r['specifier']}" for r in lock["manifest"]["requirements"]]
    assert metadata["requires-python"] == lock["requires-python"]
    crate = json.loads(read("ro-crate-metadata.json"))
    assert {"reproduce.py", "reproduce.py.lock"} <= {e["@id"] for e in crate["@graph"] if e["@type"] == "File"}
    assert "uv run reproduce.py" in read("README.md")


def test_the_reproduce_lock_pins_the_image_versions():
    # Packages are built in the download_scheduler image; relock with
    # build_reproduce_lock() (see its docstring) when this fails.
    image = tomllib.loads((Path(__file__).parents[2] / "download_scheduler" / "uv.lock").read_text())
    installed = {p["name"]: f"=={p['version']}" for p in image["package"]}
    lock = tomllib.loads(package.REPRODUCE_LOCK.read_text())

    pins = {r["name"]: r["specifier"] for r in lock["manifest"]["requirements"]}
    assert pins == {name: installed[name] for name in package.REPRODUCE_DEPENDENCIES}
    assert lock["requires-python"] == image["requires-python"]


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

    assert [f["n_rows"] for [f] in written] == [1] * 32


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

    assert sum(f["n_rows"] for f in written) == n_rows


def test_the_readme_also_ships_as_a_standalone_web_page(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=_METADATA)))

    html = read("README.html")
    assert html.startswith("<!doctype html>") and '<html lang="en">' in html
    assert "<title>CIOOS Data Explorer download pkg001</title>" in html
    assert "<h1>CIOOS Data Explorer download pkg001</h1>" in html
    assert "<table>" in html and '<a href="Good_data_example_ca/">' in html
    assert 'src="data:image/svg+xml;base64,' in html
    # Opened offline from disk: no stylesheet, script, image or font is fetched.
    assert not re.search(r'<link\b|<script[^>]*\ssrc=|src="https?:|url\(', html)
    assert "[`Good_data_example_ca/`](Good_data_example_ca/)" in read("README.md")
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
    assert "| Jeu de données | Statut | Lignes | Dossier | Source |" in readme
    assert (
        "[ERDDAP](<https://data.example.ca/erddap/info/Good/index.html>) · "
        "[Catalogue SIOOC](<https://catalogue.cioos.ca/dataset/abc>) · "
        "[DOI](<https://doi.org/10.1234/abc>)"
    ) in readme
    assert '<a href="https://catalogue.cioos.ca/dataset/abc">Catalogue SIOOC</a>' in read("README.html")


def test_an_obis_dataset_links_to_its_obis_page(tmp_path, monkeypatch):
    export = tmp_path / "export.parquet"
    _raw_obis(export)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    obis = _dataset("abc", source_type="obis", erddap_url="https://obis.org", cdm_data_type="Point")
    _, _, read = _run(tmp_path, _query(obis))

    assert "| [OBIS](<https://obis.org/dataset/abc>) |" in read("README.md")


def test_harvested_citations_are_cleaned_into_one_sentence(tmp_path):
    metadata = {"citation": {"en": "Centre for Ocean Ventures &amp; Entrepreneurship (2026).\n  Halifax  Buoy. https://x.ca/d?local=en"}}
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=metadata)))

    assert read("Good_data_example_ca/citation.txt").startswith(
        "Centre for Ocean Ventures & Entrepreneurship (2026). Halifax Buoy. https://x.ca/d?local=en. Subset:"
    )


def test_readme_citations_link_the_request_instead_of_printing_it(tmp_path):
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=_METADATA)))

    readme = read("README.md")
    cite = readme[readme.index("## How to cite"):readme.index("## Licences")]
    assert "### Title Good" in cite
    assert "> Hakai Institute (2021). CTD profiles. <https://doi.org/10.1234/abc>" in cite
    assert re.search(r"- Retrieved: \d{4}-\d\d-\d\d \d\d:\d\d UTC", cite)
    assert "- Request: [data.example.ca](<https://data.example.ca/erddap/tabledap/Good.csv?" in cite
    assert "- Citation to copy: [`Good_data_example_ca/citation.txt`](Good_data_example_ca/citation.txt)" in cite
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
    assert _embedded_citations(html) == {"Good_data_example_ca": read("Good_data_example_ca/citation.txt").strip()}
    assert 'title = "Copier la citation"' in html and '<span class="sr-only">Copié</span>' in html


def test_citation_text_cannot_close_the_embedded_script(tmp_path):
    metadata = {"citation": {"en": "Evil (2026). </script><script>alert(3)</script>"}}
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=metadata)))

    html = read("README.html")
    assert "<script>alert(3)" not in html
    assert "</script><script>alert(3)" in _embedded_citations(html)["Good_data_example_ca"]


def test_readme_licences_are_a_table_with_linked_names(tmp_path):
    bare = _dataset("Bare")
    worded = _dataset("Worded", metadata={"license": {"title": "This work is licensed  under a CC&amp;BY licence"}})
    _, _, read = _run(tmp_path, _query(_dataset("Good", metadata=_METADATA), worded, bare))

    readme = read("README.md")
    licences = readme[readme.index("## Licences"):readme.index("## Reproduce")]
    assert "| Dataset | Licence |" in licences
    assert "| Title Good | [CC-BY-4.0](<https://creativecommons.org/licenses/by/4.0/>) |" in licences
    assert "| Title Worded | This work is licensed under a CC&BY licence |" in licences
    assert "| Title Bare | *no licence recorded; check the source* |" in licences
    assert "This work is licensed under a CC&BY licence" in read("rights.txt")


@pytest.mark.parametrize(
    ("language", "label", "section", "anchor"),
    [("en", "On this page:", "Datasets", "datasets"), ("fr", "Sur cette page :", "Jeux de données", "jeux-de-données")],
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
    ("language", "opening"),
    [("en", "This package holds the data you selected"), ("fr", "Ce paquet contient les données")],
)
def test_the_readme_opens_by_explaining_the_package_and_where_its_data_came_from(tmp_path, language, opening):
    _, _, read = _run(tmp_path, _query(_dataset("Good"), language=language))

    readme = read("README.md")
    assert readme.index(opening) < readme.index("## ")
    assert "OBIS" in readme[: readme.index("## ")] and "ERDDAP" in readme[: readme.index("## ")]
