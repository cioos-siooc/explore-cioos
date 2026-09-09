import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from erddap_downloader import downloader_wrapper

QUERIES = list((Path(__file__).parent / "queries").glob("*.json"))

# Minimal ERDDAP CSV: header row + units row + one data row.
# Point (52.0, -130.0) is inside the ADCP polygon used by adcp_query.json.
_FAKE_CSV_BYTES = (
    "time,latitude,longitude,depth\r\n"
    "UTC,degrees_north,degrees_east,m\r\n"
    "2020-01-01T00:00:00Z,52.0,-130.0,5.0\r\n"
).encode()

_FAKE_VARS = pd.DataFrame(
    {"name": ["time", "latitude", "longitude", "depth"], "cf_role": ["", "", "", ""]}
)


def _mock_erddap_class():
    """Mock for cde_harvester.sources.erddap.client — returns a fake dataset with minimal variable metadata."""
    instance = MagicMock()
    instance.get_dataset.return_value.df_variables = _FAKE_VARS
    cls = MagicMock(return_value=instance)
    return cls


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
        patch(
            "erddap_downloader.download_erddap.cde_harvester.ERDDAP",
            new=_mock_erddap_class(),
        ),
        patch(
            "erddap_downloader.download_erddap.ERDDAP",
            new=_mock_erddapy_class(),
        ),
        patch(
            "erddap_downloader.download_erddap.requests.get",
            return_value=_mock_requests_response(),
        ),
        patch("erddap_downloader.download_erddap.save_erddap_metadata"),
    ):
        result = downloader_wrapper.run_download_query(
            download_query=query_data,
            output_folder=tmp_path,
            create_pdf=False,
        )

    assert result is not None
    assert isinstance(result["erddap_report"], list)
    assert len(result["erddap_report"]) == len(query_data["cache_filtered"])


# One point inside the query polygon (deep + shallow) and one clearly outside it.
# date_start/date_end are epoch-ms (2015-06-01), inside the query time window.
_OBIS_DF = pd.DataFrame(
    {
        "id": ["a", "b", "c"],
        "scientificName": ["Gadus morhua", "Gadus morhua", "Pandalus borealis"],
        "latitude": [52.0, 53.0, 10.0],
        "longitude": [-130.0, -128.0, 100.0],
        "date_start": [1433116800000, 1433116800000, 1433116800000],
        "date_end": [1433116800000, 1433116800000, 1433116800000],
        "minimumDepthInMeters": [5.0, 10.0, 5.0],
        "maximumDepthInMeters": [20.0, 50.0, 20.0],
    }
)


def test_obis_download_parquet(tmp_path):
    """The OBIS source_type path reads occurrences via DuckDB and writes a
    polygon-filtered CSV (no ERDDAP/tabledap involvement)."""
    query_data = json.loads((Path(__file__).parent / "obis_query.json").read_text())

    duck_result = MagicMock()
    duck_result.df.return_value = _OBIS_DF.copy()

    with (
        patch("duckdb.sql", return_value=duck_result) as duck_sql,
        patch("erddap_downloader.download_erddap.save_obis_metadata") as save_meta,
    ):
        result = downloader_wrapper.run_download_query(
            download_query=query_data,
            output_folder=tmp_path,
            create_pdf=False,
        )

    # DuckDB was used to read the parquet (not the tabledap path).
    assert duck_sql.called
    # OBIS dataset metadata is fetched and saved for a successful download.
    assert save_meta.called
    parquet_url = duck_sql.call_args[0][0]
    assert ".parquet" in parquet_url and "obis-open-data" in parquet_url

    assert len(result["erddap_report"]) == 1
    entry = result["erddap_report"][0]
    assert entry["status"] == "COMPLETED"
    assert entry["no_data"] is False
    # Row "c" (lon 100, lat 10) is outside the polygon → dropped; 2 rows written.
    assert entry["n_records"] == 2
    assert not result["empty_download"]
    assert result["path"].endswith(".zip")


def test_obis_download_empty(tmp_path):
    """An OBIS dataset with no rows inside the selection reports EMPTY, not a crash."""
    query_data = json.loads((Path(__file__).parent / "obis_query.json").read_text())

    duck_result = MagicMock()
    duck_result.df.return_value = _OBIS_DF.iloc[2:].copy()  # only the out-of-polygon row

    with (
        patch("duckdb.sql", return_value=duck_result),
        patch("erddap_downloader.download_erddap.save_obis_metadata"),
    ):
        result = downloader_wrapper.run_download_query(
            download_query=query_data,
            output_folder=tmp_path,
            create_pdf=False,
        )

    entry = result["erddap_report"][0]
    assert entry["status"] == "EMPTY"
    assert entry["no_data"] is True
    assert result["empty_download"] is True
