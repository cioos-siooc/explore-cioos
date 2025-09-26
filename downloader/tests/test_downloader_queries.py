from pathlib import Path

import pytest

from erddap_downloader import downloader_wrapper

QUERIES = (Path(__file__).parent.parent / "queries").glob("*.json")

@pytest.mark.parametrize("query", QUERIES)
def test_downloader_query(query):
    result = downloader_wrapper.run_download_query(
        download_query=query,
        output_folder=Path("/tmp"),
        create_pdf=False,
    )
    assert result is not None