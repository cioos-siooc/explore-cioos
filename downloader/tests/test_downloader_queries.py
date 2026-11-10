import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from cioos_downloader import download_erddap, downloader_wrapper

QUERIES = list((Path(__file__).parent / "queries").glob("*.json"))

# Minimal ERDDAP CSV: header row + units row + one data row.
# Point (52.0, -130.0) is inside the ADCP polygon used by adcp_query.json.
_FAKE_CSV_BYTES = (
    b"time,latitude,longitude,depth\r\n"
    b"UTC,degrees_north,degrees_east,m\r\n"
    b"2020-01-01T00:00:00Z,52.0,-130.0,5.0\r\n"
)

_FAKE_VARS = ["time", "latitude", "longitude", "depth"]


def _mock_requests_response():
    """Mock for requests.get — 200 response yielding fake CSV bytes."""
    resp = MagicMock()
    resp.status_code = 200
    resp.iter_content = MagicMock(return_value=[_FAKE_CSV_BYTES])
    resp.__enter__ = lambda s: s
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def _mock_erddapy_class():
    """Mock for erddapy.ERDDAP — returns a stable fake download URL."""
    instance = MagicMock()
    instance.get_download_url.return_value = "https://fake.erddap/tabledap/ds.csv"
    cls = MagicMock(return_value=instance)
    return cls


def test_queries_exist():
    assert len(QUERIES) > 0


@pytest.mark.parametrize("query", QUERIES, ids=[q.name for q in QUERIES])
def test_downloader_query(query, tmp_path):
    query_data = json.loads(query.read_text())
    with (
        patch("cioos_downloader.download_erddap._variables", return_value=_FAKE_VARS),
        patch(
            "cioos_downloader.download_erddap.ERDDAP",
            new=_mock_erddapy_class(),
        ),
        patch(
            "cioos_downloader.download_erddap.requests.get",
            return_value=_mock_requests_response(),
        ),
        patch("cioos_downloader.download_erddap.save_source_metadata", return_value=[]),
    ):
        result = downloader_wrapper.run_download_query(
            download_query=query_data,
            output_folder=tmp_path,
        )

    assert result is not None
    assert isinstance(result["erddap_report"], list)
    assert len(result["erddap_report"]) == len(query_data["cache_filtered"])


# Two points inside the query polygon (deep + shallow) and one clearly outside it.
# date_start/date_end are epoch-ms (2015-06-01), inside the query time window.
def _obis_export(path, rows=slice(None)):
    interpreted = pa.table(
        {
            "scientificName": ["Gadus morhua", "Gadus morhua", "Pandalus borealis"],
            "decimalLatitude": [52.0, 53.0, 10.0],
            "decimalLongitude": [-130.0, -128.0, 100.0],
            "date_start": [1433116800000] * 3,
            "date_end": [1433116800000] * 3,
            "minimumDepthInMeters": [5.0, 10.0, 5.0],
            "maximumDepthInMeters": [20.0, 50.0, 20.0],
        }
    )[rows]
    struct = pa.StructArray.from_arrays(
        [c.combine_chunks() for c in interpreted.columns], names=interpreted.column_names
    )
    pq.write_table(pa.table({"_id": ["a", "b", "c"][rows], "interpreted": struct}), path)


def _run_obis(tmp_path, monkeypatch, rows=slice(None)):
    query_data = json.loads((Path(__file__).parent / "obis_query.json").read_text())
    export = tmp_path / "export.parquet"
    _obis_export(export, rows)
    monkeypatch.setattr(download_erddap, "OBIS_PARQUET_URL", str(export))
    with patch("cioos_downloader.download_erddap.save_source_metadata", return_value=[]) as save_meta:
        result = downloader_wrapper.run_download_query(download_query=query_data, output_folder=tmp_path / "out")
    return result, save_meta


def test_obis_download_parquet(tmp_path, monkeypatch):
    """The OBIS source_type path reads occurrences from the parquet export and
    writes a polygon-filtered CSV (no ERDDAP/tabledap involvement)."""
    result, save_meta = _run_obis(tmp_path, monkeypatch)

    # OBIS dataset metadata is fetched and saved for a successful download.
    assert save_meta.called
    assert len(result["erddap_report"]) == 1
    entry = result["erddap_report"][0]
    assert entry["download_url_list"] == [str(tmp_path / "export.parquet")]
    assert entry["status"] == "COMPLETED"
    assert entry["no_data"] is False
    # Row "c" (lon 100, lat 10) is outside the polygon → dropped; 2 rows written.
    assert entry["n_records"] == 2
    assert not result["empty_download"]
    assert result["path"].endswith(".zip")


def test_obis_download_empty(tmp_path, monkeypatch):
    """An OBIS dataset with no rows inside the selection reports EMPTY, not a crash."""
    result, _ = _run_obis(tmp_path, monkeypatch, rows=slice(2, None))  # only the out-of-polygon row

    entry = result["erddap_report"][0]
    assert entry["status"] == "EMPTY"
    assert entry["no_data"] is True
    assert result["empty_download"] is True
