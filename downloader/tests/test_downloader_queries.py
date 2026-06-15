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
    """Mock for cde_harvester.ERDDAP — returns a fake dataset with minimal variable metadata."""
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
