"""The occurrence cache is read back one slice at a time: json.load of a 472 MB
gzip cache OOM-killed a 6GB worker."""
import gzip
import json
import os

import duckdb
import pandas as pd
import pytest
from cde_harvester.sources.obis import harvester as obis_harvester
from cde_harvester.sources.obis.harvester import (
    OBISHarvester,
    _iter_occurrence_cache,
    _OccurrenceCacheWriter,
)


def make_rows(n):
    return [
        {"decimalLatitude": 44.0 + i / 1000, "decimalLongitude": -63.0, "scientificName": f"sp {i}",
         "date_start": 1_600_000_000_000 + i, "minimumDepthInMeters": None}
        for i in range(n)
    ]


def write_cache(path, rows):
    with _OccurrenceCacheWriter(path) as writer:
        writer.write(pd.DataFrame(rows))
    return path + ".gz"


@pytest.fixture
def small_reads(monkeypatch):
    """Rows straddle buffer refills instead of fitting in the first 1 MiB."""
    monkeypatch.setattr(obis_harvester, "_OCCURRENCE_CACHE_READ_CHARS", 37)


def test_round_trip_in_slices(tmp_path, small_reads):
    rows = make_rows(25)
    gz_path = write_cache(str(tmp_path / "ds.json"), rows)

    chunks = list(_iter_occurrence_cache(gz_path, slice_rows=10))

    assert [len(c) for c in chunks] == [10, 10, 5]
    expected = pd.DataFrame(rows)
    pd.testing.assert_frame_equal(pd.concat(chunks, ignore_index=True), expected)


def test_reads_a_single_shot_json_dump(tmp_path, small_reads):
    rows = make_rows(7)
    gz_path = str(tmp_path / "ds.json.gz")
    with gzip.open(gz_path, "wt") as f:
        json.dump({"results": rows, "total": len(rows)}, f)

    chunks = list(_iter_occurrence_cache(gz_path, slice_rows=3))

    assert pd.concat(chunks, ignore_index=True).to_dict(orient="records") == rows


def test_empty_cache_yields_nothing(tmp_path):
    gz_path = write_cache(str(tmp_path / "ds.json"), [])
    assert list(_iter_occurrence_cache(gz_path)) == []


@pytest.mark.parametrize("content", ['{"total": 1, "results": []}', '{"results": [{"a": 1}, {"a": '])
def test_malformed_cache_raises(tmp_path, content):
    gz_path = str(tmp_path / "ds.json.gz")
    with gzip.open(gz_path, "wt") as f:
        f.write(content)
    with pytest.raises(ValueError):
        list(_iter_occurrence_cache(gz_path))


def test_truncated_gzip_raises(tmp_path):
    gz_path = write_cache(str(tmp_path / "ds.json"), make_rows(500))
    with open(gz_path, "r+b") as f:
        f.truncate(os.path.getsize(gz_path) // 2)
    with pytest.raises(EOFError):
        list(_iter_occurrence_cache(gz_path))


class TestIterOccurrencesFromCache:
    @pytest.fixture
    def harvester(self, tmp_path):
        return OBISHarvester(limit_dataset_ids=["ds-1"], folder=str(tmp_path))

    @pytest.fixture
    def parquet_fetch(self, monkeypatch):
        """Records whether the cache was bypassed for a fresh fetch."""
        fetched = []

        class FakeConnection:
            def execute(self, query):
                fetched.append(query)

            def fetch_df_chunk(self, vectors_per_chunk=1):
                return pd.DataFrame()

            def close(self):
                pass

        monkeypatch.setattr(duckdb, "connect", lambda *a, **k: FakeConnection())
        return fetched

    def test_a_valid_cache_skips_the_fetch(self, harvester, tmp_path, parquet_fetch):
        write_cache(str(tmp_path / "ds-1.json"), make_rows(3))

        chunks = list(harvester.iter_occurrences("ds-1"))

        assert sum(len(c) for c in chunks) == 3
        assert parquet_fetch == []

    def test_a_corrupt_cache_is_deleted_and_refetched(self, harvester, tmp_path, parquet_fetch):
        gz_path = tmp_path / "ds-1.json.gz"
        with gzip.open(gz_path, "wt") as f:
            f.write("not json")

        list(harvester.iter_occurrences("ds-1"))

        assert parquet_fetch, "a corrupt cache must fall through to a fresh fetch"

    def test_corruption_after_a_slice_propagates(self, harvester, tmp_path, parquet_fetch, monkeypatch):
        """Re-fetching mid-dataset would double-count the slices already consumed."""
        monkeypatch.setattr(obis_harvester, "OCCURRENCE_CACHE_SLICE_ROWS", 2)
        gz_path = tmp_path / "ds-1.json.gz"
        with gzip.open(gz_path, "wt") as f:
            f.write('{"results": [{"a": 1}, {"a": 2}, {"a": ')

        with pytest.raises(ValueError):
            list(harvester.iter_occurrences("ds-1"))
        assert parquet_fetch == []
        assert not gz_path.exists(), "the retry must not read the same corrupt file again"
