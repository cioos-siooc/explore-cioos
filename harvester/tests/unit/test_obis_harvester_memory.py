"""
Unit tests for OBISHarvester.harvest()'s chunked-flush memory behavior.

A full discovery run (~971 datasets) OOM-killed a 6GB container mid-run
because all_cells held every processed dataset's DataFrame in memory for the
whole run, with no flush point until the final concat. These tests verify
cells are periodically flushed to disk and correctly reassembled, and that
the returned result is identical regardless of chunk size.
"""
import os

import pandas as pd
import pytest

import cde_harvester.sources.obis.harvester as obis_harvester_module
from cde_harvester.sources.obis.harvester import OBISHarvester


class AlwaysExemptGeoFilter:
    """Bypasses the geo extent/point check so synthetic metadata is accepted
    without exercising the real polygon logic (covered elsewhere)."""

    mode = "canada"

    def is_exempt(self, metadata):
        return True

    def extent_intersects(self, extent):
        return True

    def filter_points(self, lat, lon):
        return [True] * len(lat)


def make_occurrences(n, lat=44.6, lon=-63.6):
    return {
        "results": [
            {
                "decimalLatitude": lat,
                "decimalLongitude": lon,
                "scientificName": "Gadus morhua",
                "date_start": 0,
                "date_end": 0,
                "minimumDepthInMeters": 0,
                "maximumDepthInMeters": 0,
            }
            for _ in range(n)
        ],
        "total": n,
    }


@pytest.fixture
def harvester(tmp_path, monkeypatch):
    h = OBISHarvester(
        limit_dataset_ids=[f"ds-{i}" for i in range(5)],
        folder=str(tmp_path),
        geo_filter=AlwaysExemptGeoFilter(),
    )
    monkeypatch.setattr(h, "fetch_dataset_metadata", lambda dataset_id: {})
    monkeypatch.setattr(h, "get_occurrences", lambda dataset_id: make_occurrences(3))
    return h


def test_cells_are_flushed_in_chunks_not_held_for_the_whole_run(harvester, monkeypatch):
    """With CELLS_FLUSH_EVERY=2 and 5 datasets, cells must be written to disk
    more than once (mid-run flushes), not only in one end-of-run write."""
    harvester.CELLS_FLUSH_EVERY = 2
    write_sizes = []
    real_to_pickle = pd.DataFrame.to_pickle

    def spy_to_pickle(self, path, *a, **kw):
        write_sizes.append(len(self))
        return real_to_pickle(self, path, *a, **kw)

    monkeypatch.setattr(pd.DataFrame, "to_pickle", spy_to_pickle)

    result = harvester.harvest()

    # 5 datasets / flush every 2 -> flush after dataset 2, after dataset 4,
    # and a final partial flush after dataset 5 -> 3 chunk writes, none of
    # which ever holds all 5 datasets' cells at once.
    assert len(write_sizes) == 3
    assert max(write_sizes) < 5
    assert result.obis_cells.shape[0] == 5


def test_final_result_is_identical_regardless_of_chunk_size(monkeypatch, tmp_path):
    """Chunking is an internal memory optimization; the returned obis_cells
    must not depend on CELLS_FLUSH_EVERY."""

    def build_result(flush_every):
        h = OBISHarvester(
            limit_dataset_ids=[f"ds-{i}" for i in range(5)],
            folder=str(tmp_path / str(flush_every)),
            geo_filter=AlwaysExemptGeoFilter(),
        )
        h.CELLS_FLUSH_EVERY = flush_every
        monkeypatch.setattr(h, "fetch_dataset_metadata", lambda dataset_id: {})
        monkeypatch.setattr(h, "get_occurrences", lambda dataset_id: make_occurrences(3))
        return h.harvest()

    unchunked = build_result(1000)  # never flushes mid-run
    chunked = build_result(2)  # flushes twice mid-run, plus the final partial flush

    pd.testing.assert_frame_equal(
        unchunked.obis_cells.sort_values("dataset_id").reset_index(drop=True),
        chunked.obis_cells.sort_values("dataset_id").reset_index(drop=True),
    )


def test_chunk_temp_directory_is_cleaned_up_after_harvest(harvester):
    """The TemporaryDirectory used for chunk files must not leak on disk."""
    seen_dirs = []
    original_cls = obis_harvester_module.tempfile.TemporaryDirectory

    class SpyTempDir(original_cls):
        def __enter__(self):
            path = super().__enter__()
            seen_dirs.append(path)
            return path

    obis_harvester_module.tempfile.TemporaryDirectory = SpyTempDir
    try:
        harvester.harvest()
    finally:
        obis_harvester_module.tempfile.TemporaryDirectory = original_cls

    assert seen_dirs, "expected the harvest to create a chunk temp dir"
    assert not os.path.isdir(seen_dirs[0])


def test_chunk_temp_directory_is_cleaned_up_even_on_error(tmp_path, monkeypatch):
    """A dataset that raises on every retry must not leak the chunk temp dir."""
    h = OBISHarvester(
        limit_dataset_ids=["ds-boom"],
        folder=str(tmp_path),
        geo_filter=AlwaysExemptGeoFilter(),
    )

    def boom(dataset_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(h, "fetch_dataset_metadata", boom)

    seen_dirs = []
    original_cls = obis_harvester_module.tempfile.TemporaryDirectory

    class SpyTempDir(original_cls):
        def __enter__(self):
            path = super().__enter__()
            seen_dirs.append(path)
            return path

    obis_harvester_module.tempfile.TemporaryDirectory = SpyTempDir
    try:
        result = h.harvest()
    finally:
        obis_harvester_module.tempfile.TemporaryDirectory = original_cls

    # Retries are exhausted and the dataset is recorded as an error, not raised.
    assert result.skipped.shape[0] == 1
    assert seen_dirs and not os.path.isdir(seen_dirs[0])
