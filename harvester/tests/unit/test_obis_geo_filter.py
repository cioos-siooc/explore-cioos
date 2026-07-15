"""
Unit tests for cde_harvester.obis_geo_filter.ObisGeoFilter.

All tests use a small synthetic WKT polygon (a box over part of BC)
written to a tmp_path file, avoiding the large Canada EEZ polygon.
"""

import numpy as np
import pytest

from cde_harvester.obis_geo_filter import ObisGeoFilter, DEFAULT_EXEMPT_NODE_IDS

# A small box on the BC coast: lon -130..-120, lat 48..55
TEST_POLYGON_WKT = (
    "POLYGON((-130.0 48.0, -120.0 48.0, -120.0 55.0, -130.0 55.0, -130.0 48.0))"
)

# A point clearly inside the box
INSIDE_LAT, INSIDE_LON = 51.0, -125.0

# A point clearly outside (Atlantic Canada)
OUTSIDE_LAT, OUTSIDE_LON = 44.0, -63.0


@pytest.fixture
def polygon_file(tmp_path):
    f = tmp_path / "test_boundary.wkt"
    f.write_text(TEST_POLYGON_WKT)
    return str(f)


@pytest.fixture
def geo_filter(polygon_file):
    return ObisGeoFilter(mode="canada", polygon_file=polygon_file)


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------

class TestObisGeoFilterInit:
    def test_mode_none_sets_no_polygon(self):
        gf = ObisGeoFilter(mode="none")
        assert gf.polygon is None

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError, match="Unsupported geo filter mode"):
            ObisGeoFilter(mode="world")

    def test_canada_mode_loads_polygon(self, geo_filter):
        assert geo_filter.polygon is not None

    def test_custom_exempt_node_ids_stored(self, polygon_file):
        custom = {"my-node-uuid"}
        gf = ObisGeoFilter(mode="canada", polygon_file=polygon_file, exempt_node_ids=custom)
        assert "my-node-uuid" in gf.exempt_node_ids

    def test_default_exempt_nodes_include_known_ids(self, geo_filter):
        for node_id in DEFAULT_EXEMPT_NODE_IDS:
            assert node_id in geo_filter.exempt_node_ids


# ---------------------------------------------------------------------------
# is_exempt
# ---------------------------------------------------------------------------

class TestIsExempt:
    def test_known_exempt_node_returns_true(self, geo_filter):
        obis_canada_id = "7dfb2d90-9317-434d-8d4e-64adf324579a"
        metadata = {"nodes": [{"id": obis_canada_id}]}
        assert geo_filter.is_exempt(metadata) is True

    def test_unknown_node_returns_false(self, geo_filter):
        metadata = {"nodes": [{"id": "00000000-0000-0000-0000-000000000000"}]}
        assert geo_filter.is_exempt(metadata) is False

    def test_empty_nodes_list_returns_false(self, geo_filter):
        assert geo_filter.is_exempt({"nodes": []}) is False

    def test_missing_nodes_key_returns_false(self, geo_filter):
        assert geo_filter.is_exempt({}) is False

    def test_mode_none_always_exempt(self):
        gf = ObisGeoFilter(mode="none")
        assert gf.is_exempt({}) is True
        assert gf.is_exempt({"nodes": []}) is True


# ---------------------------------------------------------------------------
# extent_intersects
# ---------------------------------------------------------------------------

class TestExtentIntersects:
    def test_overlapping_extent_returns_true(self, geo_filter):
        # A box that overlaps the test polygon
        extent = "POLYGON((-126.0 50.0, -124.0 50.0, -124.0 52.0, -126.0 52.0, -126.0 50.0))"
        assert geo_filter.extent_intersects(extent) is True

    def test_non_overlapping_extent_returns_false(self, geo_filter):
        # Atlantic — well outside the test polygon
        extent = "POLYGON((-65.0 43.0, -60.0 43.0, -60.0 47.0, -65.0 47.0, -65.0 43.0))"
        assert geo_filter.extent_intersects(extent) is False

    def test_none_extent_returns_none(self, geo_filter):
        assert geo_filter.extent_intersects(None) is None

    def test_empty_string_extent_returns_none(self, geo_filter):
        assert geo_filter.extent_intersects("") is None

    def test_invalid_wkt_returns_none(self, geo_filter):
        assert geo_filter.extent_intersects("NOT_VALID_WKT") is None

    def test_mode_none_always_returns_none(self):
        gf = ObisGeoFilter(mode="none")
        extent = "POLYGON((-126.0 50.0, -124.0 50.0, -124.0 52.0, -126.0 52.0, -126.0 50.0))"
        assert gf.extent_intersects(extent) is None


# ---------------------------------------------------------------------------
# filter_points
# ---------------------------------------------------------------------------

class TestFilterPoints:
    def test_point_inside_returns_true(self, geo_filter):
        mask = geo_filter.filter_points(
            lat=np.array([INSIDE_LAT]),
            lon=np.array([INSIDE_LON]),
        )
        assert mask[0] is True or bool(mask[0])

    def test_point_outside_returns_false(self, geo_filter):
        mask = geo_filter.filter_points(
            lat=np.array([OUTSIDE_LAT]),
            lon=np.array([OUTSIDE_LON]),
        )
        assert not (mask[0] is True or bool(mask[0]))

    def test_mixed_points_partial_mask(self, geo_filter):
        mask = geo_filter.filter_points(
            lat=np.array([INSIDE_LAT, OUTSIDE_LAT, INSIDE_LAT]),
            lon=np.array([INSIDE_LON, OUTSIDE_LON, INSIDE_LON]),
        )
        assert bool(mask[0]) is True
        assert bool(mask[1]) is False
        assert bool(mask[2]) is True

    def test_returns_numpy_array(self, geo_filter):
        mask = geo_filter.filter_points(
            lat=np.array([INSIDE_LAT]),
            lon=np.array([INSIDE_LON]),
        )
        assert isinstance(mask, np.ndarray)

    def test_mode_none_returns_all_true(self):
        gf = ObisGeoFilter(mode="none")
        mask = gf.filter_points(
            lat=np.array([OUTSIDE_LAT, OUTSIDE_LAT]),
            lon=np.array([OUTSIDE_LON, OUTSIDE_LON]),
        )
        assert all(mask)

    def test_empty_arrays_return_empty_mask(self, geo_filter):
        mask = geo_filter.filter_points(lat=np.array([]), lon=np.array([]))
        assert len(mask) == 0
