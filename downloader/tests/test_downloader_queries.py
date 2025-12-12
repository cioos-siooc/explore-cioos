from pathlib import Path
import json

import pytest

from erddap_downloader import downloader_wrapper

QUERIES = list((Path(__file__).parent / "queries").glob("*.json"))

def test_queries_exist():
    assert len(QUERIES) > 0

@pytest.mark.parametrize("query", QUERIES)
def test_downloader_query(query, tmp_path):
    query = json.loads(query.read_text())
    result = downloader_wrapper.run_download_query(
        download_query=query,
        output_folder=tmp_path,
        create_pdf=False,
    )
    assert result is not None