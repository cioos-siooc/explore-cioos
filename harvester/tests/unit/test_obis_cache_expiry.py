"""OBIS caches never expire on their own, so a dataset OBIS re-ingests (a new
parquet export) must be re-fetched instead of rebuilt from the stale cache."""
import os
from email.utils import formatdate

import pytest
import requests
from cde_harvester.sources.obis.harvester import OBISHarvester

CACHED_AT = 1_750_000_000


class FakeHead:
    def __init__(self, last_modified=None, status_code=200):
        self.headers = {} if last_modified is None else {"Last-Modified": formatdate(last_modified, usegmt=True)}
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")


@pytest.fixture
def harvester(tmp_path):
    h = OBISHarvester(limit_dataset_ids=["ds"], folder=str(tmp_path))
    for name in ["ds.json.gz", "ds_metadata.json.gz", "ds_cioos.json.gz"]:
        path = tmp_path / name
        path.write_bytes(b"")
        os.utime(path, (CACHED_AT, CACHED_AT))
    return h


def head_returning(monkeypatch, response):
    calls = []

    def fake_head(url, **kwargs):
        calls.append(url)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(requests, "head", fake_head)
    return calls


def test_republished_parquet_clears_the_whole_dataset_cache(harvester, monkeypatch):
    calls = head_returning(monkeypatch, FakeHead(last_modified=CACHED_AT + 3600))
    harvester._expire_stale_cache("ds")
    assert calls == ["https://obis-open-data.s3.amazonaws.com/occurrence/ds.parquet"]
    assert harvester._cache_files("ds") == []


def test_parquet_older_than_the_cache_keeps_it(harvester, monkeypatch):
    head_returning(monkeypatch, FakeHead(last_modified=CACHED_AT - 3600))
    harvester._expire_stale_cache("ds")
    assert len(harvester._cache_files("ds")) == 3


def test_compares_against_the_oldest_cache_file(harvester, monkeypatch, tmp_path):
    """Metadata is cached before the occurrences download; a parquet rewritten
    in between must still count as newer than the cache."""
    newer = CACHED_AT + 7200
    os.utime(tmp_path / "ds.json.gz", (newer, newer))
    head_returning(monkeypatch, FakeHead(last_modified=CACHED_AT + 3600))
    harvester._expire_stale_cache("ds")
    assert harvester._cache_files("ds") == []


@pytest.mark.parametrize("response", [
    FakeHead(status_code=404),
    FakeHead(last_modified=None),
    requests.ConnectionError("down"),
])
def test_unknown_freshness_keeps_the_cache(harvester, monkeypatch, response):
    head_returning(monkeypatch, response)
    harvester._expire_stale_cache("ds")
    assert len(harvester._cache_files("ds")) == 3


def test_no_cache_makes_no_request(tmp_path, monkeypatch):
    calls = head_returning(monkeypatch, FakeHead(last_modified=CACHED_AT))
    OBISHarvester(limit_dataset_ids=["ds"], folder=str(tmp_path))._expire_stale_cache("ds")
    assert calls == []
