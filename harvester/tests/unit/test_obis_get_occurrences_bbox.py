"""
Unit tests for the bbox pre-filter in OBISHarvester.iter_occurrences.

geo_filter.bounds() gives a bounding box that is a strict superset of the
Canada EEZ polygon: any point outside it is guaranteed to also fail the
precise polygon test that aggregate_cells runs later. Passing it into the
DuckDB query narrows what the parquet reader has to materialize for
global/out-of-region datasets (e.g. ESAS, iNaturalist) without changing which
occurrences end up kept -- see geo_filter.py's bounds() docstring.
"""
import os

import duckdb
import pandas as pd
import pytest
from cde_harvester.sources.obis.harvester import OBISHarvester

RESULT_COLUMNS = [
    "decimalLatitude", "decimalLongitude", "date_start", "date_end",
    "minimumDepthInMeters", "maximumDepthInMeters", "scientificName",
]


@pytest.fixture
def harvester(tmp_path):
    return OBISHarvester(limit_dataset_ids=["ds-1"], folder=str(tmp_path))


@pytest.fixture
def captured_queries(monkeypatch):
    """Capture the SQL and hand back an immediately-exhausted chunk stream.

    fetch_df_chunk signals end-of-stream with an empty frame that still
    carries the columns, which is what duckdb really returns.
    """
    class Captured(list):
        """The SQL strings, plus whether the connection was closed."""
        closed = 0

    captured = Captured()

    class FakeRelation:
        def fetch_df_chunk(self, vectors_per_chunk=1):
            return pd.DataFrame(columns=RESULT_COLUMNS)

    class FakeConnection:
        def execute(self, query):
            captured.append(query)   # the COPY, which wraps the SELECT verbatim

        def sql(self, query):
            return FakeRelation()

        def close(self):
            captured.closed += 1

    monkeypatch.setattr(duckdb, "connect", lambda *a, **k: FakeConnection())
    return captured


def drain(harvester, *args, **kwargs):
    return list(harvester.iter_occurrences(*args, **kwargs))


class TestGetOccurrencesBbox:
    def test_no_bbox_uses_full_mercator_world_bounds(self, harvester, captured_queries):
        drain(harvester, "ds-1", bbox=None)

        query = captured_queries[0]
        assert "BETWEEN -85.06 AND 85.06" in query
        assert "BETWEEN -180 AND 180" in query

    def test_bbox_narrows_query_to_polygon_bounds(self, harvester, captured_queries):
        drain(harvester, "ds-1", bbox=(-130.0, 48.0, -120.0, 55.0))

        query = captured_queries[0]
        assert "BETWEEN 48.0 AND 55.0" in query
        assert "BETWEEN -130.0 AND -120.0" in query

    def test_bbox_wider_than_mercator_range_is_clamped(self, harvester, captured_queries):
        # A bbox exceeding the +/-85.06 mercator limit must not widen the
        # query past what the existing out-of-range coordinate drop allows.
        drain(harvester, "ds-1", bbox=(-180.0, -90.0, 180.0, 90.0))

        assert "BETWEEN -85.06 AND 85.06" in captured_queries[0]

    def test_default_bbox_is_none(self, harvester, captured_queries):
        """Callers that omit bbox (the REST-fallback path never passes it)
        must still get the full world query, not a NameError."""
        drain(harvester, "ds-1")

        query = captured_queries[0]
        assert "BETWEEN -85.06 AND 85.06" in query
        assert "BETWEEN -180 AND 180" in query


# ---------------------------------------------------------------------------
# harvest() wiring: exempt datasets fetch unbounded, others get the geo
# filter's polygon bounds as a pre-filter.
# ---------------------------------------------------------------------------

class StubGeoFilter:
    mode = "canada"

    def __init__(self, exempt_ids):
        self.exempt_ids = exempt_ids

    def is_exempt(self, metadata):
        return metadata.get("id") in self.exempt_ids

    def extent_intersects(self, extent):
        return True

    def filter_points(self, lat, lon):
        return [True] * len(lat)

    def bounds(self):
        return (-130.0, 48.0, -120.0, 55.0)


def _make_occurrences():
    return pd.DataFrame([{
        "decimalLatitude": 51.0, "decimalLongitude": -125.0,
        "scientificName": "Gadus morhua", "date_start": 0, "date_end": 0,
        "minimumDepthInMeters": 0, "maximumDepthInMeters": 0,
    }])


class TestHarvestBboxWiring:
    def test_exempt_dataset_fetches_without_bbox(self, tmp_path, monkeypatch):
        h = OBISHarvester(
            limit_dataset_ids=["exempt-ds"], folder=str(tmp_path),
            geo_filter=StubGeoFilter(exempt_ids={"exempt-ds"}),
        )
        monkeypatch.setattr(h, "fetch_dataset_metadata", lambda dataset_id: {"id": dataset_id})
        seen_bbox = []
        monkeypatch.setattr(
            h, "iter_occurrences",
            lambda dataset_id, bbox=None: seen_bbox.append(bbox) or iter([_make_occurrences()]),
        )

        h.harvest()

        assert seen_bbox == [None]

    def test_non_exempt_dataset_fetches_with_geo_filter_bounds(self, tmp_path, monkeypatch):
        h = OBISHarvester(
            limit_dataset_ids=["other-ds"], folder=str(tmp_path),
            geo_filter=StubGeoFilter(exempt_ids=set()),
        )
        monkeypatch.setattr(h, "fetch_dataset_metadata", lambda dataset_id: {"id": dataset_id})
        seen_bbox = []
        monkeypatch.setattr(
            h, "iter_occurrences",
            lambda dataset_id, bbox=None: seen_bbox.append(bbox) or iter([_make_occurrences()]),
        )

        h.harvest()

        assert seen_bbox == [(-130.0, 48.0, -120.0, 55.0)]


# ---------------------------------------------------------------------------
# Chunked fetch: the stream contract, and the duckdb connection's lifetime.
# ---------------------------------------------------------------------------

class TestChunkedFetch:
    def test_chunks_are_yielded_until_the_empty_terminator(self, harvester, monkeypatch):
        pages = [
            pd.DataFrame({c: [1.0] * 3 for c in RESULT_COLUMNS}),
            pd.DataFrame({c: [1.0] * 2 for c in RESULT_COLUMNS}),
            pd.DataFrame(columns=RESULT_COLUMNS),  # duckdb's end-of-stream frame
        ]

        class FakeRelation:
            def fetch_df_chunk(self, vectors_per_chunk=1):
                return pages.pop(0)

        class FakeConnection:
            def execute(self, query):
                pass

            def sql(self, query):
                return FakeRelation()

            def close(self):
                pass

        monkeypatch.setattr(duckdb, "connect", lambda *a, **k: FakeConnection())

        got = drain(harvester, "ds-1")

        assert [len(c) for c in got] == [3, 2], "the terminator must end the stream, not be yielded"

    def test_connection_is_closed_when_the_query_raises(self, harvester, monkeypatch):
        closed = []

        class FakeConnection:
            def execute(self, query):
                raise RuntimeError("parquet unavailable")

            def close(self):
                closed.append(True)

        monkeypatch.setattr(duckdb, "connect", lambda *a, **k: FakeConnection())
        # Failing before the first chunk falls back to the REST API, so stub it.
        monkeypatch.setattr(harvester, "_iter_occurrences_api", lambda dataset_id: iter([]))

        drain(harvester, "ds-1")

        assert closed, "the duckdb connection must be closed even when the query raises"

    def test_connection_is_closed_on_a_successful_stream(self, harvester, captured_queries):
        drain(harvester, "ds-1")
        assert captured_queries.closed == 1

    def test_failure_before_any_chunk_falls_back_to_the_rest_api(self, harvester, monkeypatch):
        class FakeConnection:
            def execute(self, query):
                raise RuntimeError("404 parquet not found")

            def close(self):
                pass

        monkeypatch.setattr(duckdb, "connect", lambda *a, **k: FakeConnection())
        fallback = pd.DataFrame({c: [1.0] for c in RESULT_COLUMNS})
        monkeypatch.setattr(harvester, "_iter_occurrences_api", lambda dataset_id: iter([fallback]))

        got = drain(harvester, "ds-1")

        assert len(got) == 1 and len(got[0]) == 1

    def test_failure_after_a_chunk_propagates_rather_than_double_counting(self, harvester, monkeypatch):
        """Re-fetching from REST mid-dataset would re-aggregate the rows the
        caller already consumed, so the retry loop must redo the whole dataset."""
        calls = {"api": 0}

        class FakeRelation:
            def __init__(self):
                self.n = 0

            def fetch_df_chunk(self, vectors_per_chunk=1):
                self.n += 1
                if self.n == 1:
                    return pd.DataFrame({c: [1.0] * 3 for c in RESULT_COLUMNS})
                raise RuntimeError("connection reset mid-stream")

        class FakeConnection:
            def execute(self, query):
                pass

            def sql(self, query):
                return FakeRelation()

            def close(self):
                pass

        monkeypatch.setattr(duckdb, "connect", lambda *a, **k: FakeConnection())
        monkeypatch.setattr(
            harvester, "_iter_occurrences_api",
            lambda dataset_id: calls.__setitem__("api", calls["api"] + 1) or iter([]),
        )

        with pytest.raises(RuntimeError, match="mid-stream"):
            drain(harvester, "ds-1")
        assert calls["api"] == 0, "must not silently fall back after yielding rows"

    def test_a_failed_stream_leaves_no_cache_behind(self, harvester, monkeypatch, tmp_path):
        class FakeRelation:
            def __init__(self):
                self.n = 0

            def fetch_df_chunk(self, vectors_per_chunk=1):
                self.n += 1
                if self.n == 1:
                    return pd.DataFrame({c: [1.0] * 3 for c in RESULT_COLUMNS})
                raise RuntimeError("boom")

        class FakeConnection:
            def execute(self, query):
                pass

            def sql(self, query):
                return FakeRelation()

            def close(self):
                pass

        monkeypatch.setattr(duckdb, "connect", lambda *a, **k: FakeConnection())

        with pytest.raises(RuntimeError):
            drain(harvester, "ds-1")

        leftovers = [f for f in os.listdir(tmp_path) if f.startswith("ds-1")]
        assert leftovers == [], f"a half-written cache must not survive: {leftovers}"
