"""
Live OBIS discovery tests. Skipped unless CDE_LIVE_TESTS=1.

    CDE_LIVE_TESTS=1 uv run pytest tests/integration/test_obis_discovery_live.py -q

Floors are deliberately loose so normal upstream churn (datasets added or
retired at OBIS) doesn't flake CI. What these actually assert is that the two
API contracts discovery depends on still hold:

  * /v3/dataset returns the whole result set when `size` covers `total`
    (the `from` offset param is ignored, so there is no pagination fallback)
  * the geometry filter accepts the reduced Canada polygon and is record-level
"""

import os

import pytest

from cde_harvester.sources.obis.discovery import (
    ObisDatasetDiscovery,
    ObisDiscoveryConfig,
    default_discovery_config,
    simplify_for_query,
)
from cde_harvester.sources.obis.geo_filter import ObisGeoFilter, load_boundary_polygon

pytestmark = [
    pytest.mark.network,
    pytest.mark.skipif(
        os.getenv("CDE_LIVE_TESTS") != "1",
        reason="live upstream test; set CDE_LIVE_TESTS=1 to run",
    ),
]

OBIS_CANADA = "7dfb2d90-9317-434d-8d4e-64adf324579a"
OTN_OBIS = "68f83ea7-69a7-44fd-be77-3c3afd6f3cf8"


@pytest.fixture(scope="module")
def geo_filter():
    return ObisGeoFilter(mode="canada")


def single_query_count(node_id=None, geometry=None):
    """Run one discovery query live and return the id count."""
    cfg = ObisDiscoveryConfig.from_config({
        "enabled": True,
        "nodes": [node_id] if node_id else [],
        "geometry": geometry or "none",
        "min_datasets": 0,
    })
    d = ObisDatasetDiscovery(cfg, geo_filter=ObisGeoFilter(mode="canada"))
    label = f"node:{node_id}" if node_id else "geometry"
    params = {"nodeid": node_id} if node_id else {"geometry": geometry}
    # _query raises if `total` exceeds the returned results, which is the
    # contract we care about here.
    return len(d._query(label, params, allow_empty=bool(geometry)))


class TestPerQuery:
    def test_obis_canada_node(self):
        assert single_query_count(node_id=OBIS_CANADA) >= 250

    def test_otn_obis_node(self):
        assert single_query_count(node_id=OTN_OBIS) >= 90

    def test_geometry_query(self, geo_filter):
        wkt, _ = simplify_for_query(geo_filter.polygon, tolerance=0.25, max_bytes=4500)
        assert single_query_count(geometry=wkt) >= 400


class TestFullDiscovery:
    def test_default_config_resolves_a_plausible_union(self, geo_filter):
        result = ObisDatasetDiscovery(
            default_discovery_config(min_datasets=0), geo_filter=geo_filter,
        ).discover()

        assert len(result.dataset_ids) >= 850
        assert len(set(result.dataset_ids)) == len(result.dataset_ids), "ids must be deduped"
        assert result.dataset_ids == sorted(result.dataset_ids)
        assert {f"node:{OBIS_CANADA}", f"node:{OTN_OBIS}", "geometry"} <= set(result.per_query)
        assert result.geometry_bytes <= 4500

    def test_union_exceeds_each_part(self, geo_filter):
        """The geometry query and the node queries must each contribute — if one
        silently returned nothing the union would still look plausible."""
        result = ObisDatasetDiscovery(
            default_discovery_config(min_datasets=0), geo_filter=geo_filter,
        ).discover()
        biggest_single = max(result.per_query.values())
        assert len(result.dataset_ids) > biggest_single


class TestGeometryIsRecordLevel:
    def test_reduced_polygon_contains_the_original(self):
        """The reduction must only ever over-select, never clip a coastal dataset."""
        polygon = load_boundary_polygon()
        wkt, tol = simplify_for_query(polygon, tolerance=0.25, max_bytes=4500)
        from shapely import wkt as shp_wkt

        assert shp_wkt.loads(wkt).contains(polygon)
        assert tol == 0.25
