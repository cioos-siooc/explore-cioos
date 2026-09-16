"""
Unit tests for the bbox pre-filter in OBISHarvester.get_occurrences.

geo_filter.bounds() gives a bounding box that is a strict superset of the
Canada EEZ polygon: any point outside it is guaranteed to also fail the
precise polygon test that aggregate_cells runs later. Passing it into the
DuckDB query narrows what the parquet reader has to materialize for
global/out-of-region datasets (e.g. ESAS, iNaturalist) without changing which
occurrences end up kept -- see geo_filter.py's bounds() docstring.
"""
import duckdb
import pandas as pd
import pytest
from cde_harvester.sources.obis.harvester import OBISHarvester

RESULT_COLUMNS = [
    "decimalLatitude", "decimalLongitude", "date_start", "date_end",
    "minimumDepthInMeters", "maximumDepthInMeters", "scientificName", "id",
]


@pytest.fixture
def harvester(tmp_path):
    return OBISHarvester(limit_dataset_ids=["ds-1"], folder=str(tmp_path))


@pytest.fixture
def captured_queries(monkeypatch):
    captured = []

    class FakeResult:
        def df(self):
            return pd.DataFrame(columns=RESULT_COLUMNS)

    monkeypatch.setattr(duckdb, "sql", lambda query: captured.append(query) or FakeResult())
    return captured


class TestGetOccurrencesBbox:
    def test_no_bbox_uses_full_mercator_world_bounds(self, harvester, captured_queries):
        harvester.get_occurrences("ds-1", bbox=None)

        query = captured_queries[0]
        assert "BETWEEN -85.06 AND 85.06" in query
        assert "BETWEEN -180 AND 180" in query

    def test_bbox_narrows_query_to_polygon_bounds(self, harvester, captured_queries):
        harvester.get_occurrences("ds-1", bbox=(-130.0, 48.0, -120.0, 55.0))

        query = captured_queries[0]
        assert "BETWEEN 48.0 AND 55.0" in query
        assert "BETWEEN -130.0 AND -120.0" in query

    def test_bbox_wider_than_mercator_range_is_clamped(self, harvester, captured_queries):
        # A bbox exceeding the +/-85.06 mercator limit must not widen the
        # query past what the existing out-of-range coordinate drop allows.
        harvester.get_occurrences("ds-1", bbox=(-180.0, -90.0, 180.0, 90.0))

        assert "BETWEEN -85.06 AND 85.06" in captured_queries[0]

    def test_default_bbox_is_none(self, harvester, captured_queries):
        """Callers that omit bbox (the REST-fallback path never passes it)
        must still get the full world query, not a NameError."""
        harvester.get_occurrences("ds-1")

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
    return {
        "results": [{
            "decimalLatitude": 51.0, "decimalLongitude": -125.0,
            "scientificName": "Gadus morhua", "date_start": 0, "date_end": 0,
            "minimumDepthInMeters": 0, "maximumDepthInMeters": 0,
        }],
        "total": 1,
    }


class TestHarvestBboxWiring:
    def test_exempt_dataset_fetches_without_bbox(self, tmp_path, monkeypatch):
        h = OBISHarvester(
            limit_dataset_ids=["exempt-ds"], folder=str(tmp_path),
            geo_filter=StubGeoFilter(exempt_ids={"exempt-ds"}),
        )
        monkeypatch.setattr(h, "fetch_dataset_metadata", lambda dataset_id: {"id": dataset_id})
        seen_bbox = []
        monkeypatch.setattr(
            h, "get_occurrences",
            lambda dataset_id, bbox=None: seen_bbox.append(bbox) or _make_occurrences(),
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
            h, "get_occurrences",
            lambda dataset_id, bbox=None: seen_bbox.append(bbox) or _make_occurrences(),
        )

        h.harvest()

        assert seen_bbox == [(-130.0, 48.0, -120.0, 55.0)]
