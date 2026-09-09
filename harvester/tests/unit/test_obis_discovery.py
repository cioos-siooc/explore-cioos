"""
Unit tests for cde_harvester.sources.obis.discovery.

No network: every HTTP call goes through an injected fake session. The one test
that touches real data reads the packaged boundary polygon off disk to pin the
validated simplify recipe.
"""

from unittest.mock import MagicMock

import pytest
import requests
from shapely import wkt as shp_wkt
from shapely.geometry import MultiPolygon, box

from cde_harvester.sources.obis.discovery import (
    ObisDatasetDiscovery,
    ObisDiscoveryConfig,
    ObisDiscoveryError,
    default_discovery_config,
    simplify_for_query,
)
from cde_harvester.sources.obis.geo_filter import (
    DEFAULT_EXEMPT_NODE_IDS,
    ObisGeoFilter,
    load_boundary_polygon,
)

NODE_A = "7dfb2d90-9317-434d-8d4e-64adf324579a"
NODE_B = "68f83ea7-69a7-44fd-be77-3c3afd6f3cf8"

# Two disjoint boxes, so the fixture exercises the MultiPolygon path.
TEST_POLYGON = MultiPolygon([box(-130, 48, -120, 55), box(-70, 43, -60, 50)])


@pytest.fixture
def polygon_file(tmp_path):
    f = tmp_path / "boundary.wkt"
    f.write_text(TEST_POLYGON.wkt)
    return str(f)


@pytest.fixture
def geo_filter(polygon_file):
    return ObisGeoFilter(mode="canada", polygon_file=polygon_file)


def fake_session(responses):
    """Session whose .get() returns queued payloads in order.

    Each entry is either a dict payload, or an Exception to raise.
    """
    session = MagicMock()
    queue = list(responses)

    def _get(url, params=None, timeout=None):
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        resp = MagicMock()
        resp.json.return_value = item
        resp.raise_for_status.return_value = None
        return resp

    session.get.side_effect = _get
    return session


def payload(ids):
    return {"total": len(ids), "results": [{"id": i} for i in ids]}


# ---------------------------------------------------------------------------
# ObisDiscoveryConfig.from_config
# ---------------------------------------------------------------------------

class TestDiscoveryConfig:
    def test_absent_block_is_disabled(self):
        assert ObisDiscoveryConfig.from_config(None).enabled is False
        assert ObisDiscoveryConfig.from_config({}).enabled is False

    def test_present_block_defaults_to_enabled(self):
        cfg = ObisDiscoveryConfig.from_config({"nodes": [NODE_A]})
        assert cfg.enabled is True
        assert cfg.node_ids == (NODE_A,)

    def test_explicit_disable(self):
        cfg = ObisDiscoveryConfig.from_config({"enabled": False, "nodes": [NODE_A]})
        assert cfg.enabled is False

    def test_unknown_key_raises(self):
        # A typo'd min_dataset silently defaulting to 700 is what prunes the DB.
        with pytest.raises(ValueError, match="Unknown obis_discovery key"):
            ObisDiscoveryConfig.from_config({"enabled": True, "min_dataset": 5})

    def test_enabled_with_nothing_to_query_raises(self):
        with pytest.raises(ValueError, match="nothing would be queried"):
            ObisDiscoveryConfig.from_config({"enabled": True, "geometry": "none"})

    def test_scalar_coerced_to_tuple(self):
        cfg = ObisDiscoveryConfig.from_config({"nodes": NODE_A, "include": NODE_B})
        assert cfg.node_ids == (NODE_A,)
        assert cfg.include == (NODE_B,)

    def test_non_list_nodes_raises(self):
        with pytest.raises(ValueError, match="must be a string or a list"):
            ObisDiscoveryConfig.from_config({"nodes": {"a": 1}})

    def test_non_mapping_block_raises(self):
        with pytest.raises(ValueError, match="must be a mapping"):
            ObisDiscoveryConfig.from_config(["nope"])

    def test_geometry_none_variants(self):
        assert ObisDiscoveryConfig.from_config({"nodes": [NODE_A], "geometry": None}).wants_geometry is False
        assert ObisDiscoveryConfig.from_config({"nodes": [NODE_A], "geometry": "none"}).wants_geometry is False
        assert ObisDiscoveryConfig.from_config({"geometry": "eez"}).wants_geometry is True

    def test_default_discovery_config_is_canada_and_otn(self):
        cfg = default_discovery_config()
        assert cfg.enabled is True
        assert set(cfg.node_ids) == set(DEFAULT_EXEMPT_NODE_IDS)
        assert cfg.geometry == "eez"


# ---------------------------------------------------------------------------
# simplify_for_query
# ---------------------------------------------------------------------------

class TestSimplifyForQuery:
    def test_result_contains_original(self):
        wkt, _ = simplify_for_query(TEST_POLYGON, tolerance=0.25, max_bytes=4500)
        assert shp_wkt.loads(wkt).contains(TEST_POLYGON)

    def test_respects_byte_budget(self):
        wkt, _ = simplify_for_query(TEST_POLYGON, tolerance=0.1, max_bytes=600)
        assert len(wkt.encode()) <= 600

    def test_escalates_tolerance_when_budget_tight(self):
        _, loose = simplify_for_query(TEST_POLYGON, tolerance=0.1, max_bytes=400)
        _, tight = simplify_for_query(TEST_POLYGON, tolerance=0.1, max_bytes=100000)
        assert loose >= tight

    def test_unsatisfiable_budget_raises(self):
        with pytest.raises(ObisDiscoveryError, match="Could not reduce"):
            simplify_for_query(TEST_POLYGON, tolerance=0.25, max_bytes=10)

    def test_empty_polygon_raises(self):
        with pytest.raises(ObisDiscoveryError, match="empty polygon"):
            simplify_for_query(None)

    def test_packaged_canada_polygon_fits_default_budget(self):
        """Pins the validated recipe: the real ~11 KB polygon reduces to <= 4500
        bytes at tolerance 0.25 while still containing the original."""
        polygon = load_boundary_polygon()
        wkt, tol = simplify_for_query(polygon, tolerance=0.25, max_bytes=4500)
        assert tol == 0.25, "tolerance should not need to escalate for the shipped polygon"
        assert len(wkt.encode()) <= 4500
        assert shp_wkt.loads(wkt).contains(polygon)


# ---------------------------------------------------------------------------
# _query
# ---------------------------------------------------------------------------

class TestQuery:
    def _discovery(self, responses, **cfg_overrides):
        cfg = ObisDiscoveryConfig.from_config({"nodes": [NODE_A], "geometry": "none", **cfg_overrides})
        return ObisDatasetDiscovery(cfg, session=fake_session(responses))

    def test_happy_path_returns_ids(self):
        d = self._discovery([payload(["a", "b"])])
        assert d._query("node:x", {"nodeid": "x"}) == ["a", "b"]

    def test_sends_expected_params(self):
        d = self._discovery([payload(["a"])], page_size=1234)
        d._query("node:x", {"nodeid": "x"})
        _, kwargs = d.session.get.call_args
        assert kwargs["params"] == {"nodeid": "x", "size": 1234}

    def test_truncated_response_retries_with_bigger_size(self):
        # total says 5, first response only carries 2 -> retry, then complete.
        d = self._discovery([
            {"total": 5, "results": [{"id": "a"}, {"id": "b"}]},
            payload(["a", "b", "c", "d", "e"]),
        ])
        assert len(d._query("node:x", {"nodeid": "x"})) == 5
        assert d.session.get.call_count == 2
        assert d.session.get.call_args_list[1].kwargs["params"]["size"] == 1005

    def test_still_truncated_after_retry_raises(self):
        d = self._discovery([
            {"total": 5, "results": [{"id": "a"}]},
            {"total": 5, "results": [{"id": "a"}]},
        ])
        with pytest.raises(ObisDiscoveryError, match="refusing to harvest a truncated list"):
            d._query("node:x", {"nodeid": "x"})

    def test_http_error_raises_discovery_error(self):
        d = self._discovery([requests.HTTPError("400 Bad Request")])
        with pytest.raises(ObisDiscoveryError, match="failed"):
            d._query("node:x", {"nodeid": "x"})

    def test_empty_node_result_raises(self):
        d = self._discovery([payload([])])
        with pytest.raises(ObisDiscoveryError, match="returned no datasets"):
            d._query("node:x", {"nodeid": "x"})

    def test_empty_result_allowed_when_flagged(self):
        d = self._discovery([payload([])])
        assert d._query("geometry", {"geometry": "..."}, allow_empty=True) == []


# ---------------------------------------------------------------------------
# discover()
# ---------------------------------------------------------------------------

class TestDiscover:
    def _discover(self, responses, geo_filter=None, **cfg):
        cfg = ObisDiscoveryConfig.from_config({"min_datasets": 0, **cfg})
        return ObisDatasetDiscovery(
            cfg, geo_filter=geo_filter, session=fake_session(responses),
        ).discover()

    def test_unions_and_dedupes_sorted(self, geo_filter):
        result = self._discover(
            [payload(["b", "a"]), payload(["a", "c"]), payload(["d"])],
            geo_filter=geo_filter,
            nodes=[NODE_A, NODE_B],
        )
        assert result.dataset_ids == ["a", "b", "c", "d"]
        assert result.per_query[f"node:{NODE_A}"] == 2
        assert result.per_query["geometry"] == 1

    def test_geometry_disabled_runs_only_node_queries(self):
        result = self._discover([payload(["a"])], nodes=[NODE_A], geometry="none")
        assert result.dataset_ids == ["a"]
        assert "geometry" not in result.per_query
        assert result.geometry_bytes is None

    def test_include_adds_ids(self):
        result = self._discover(
            [payload(["a"])], nodes=[NODE_A], geometry="none", include=["z"],
        )
        assert result.dataset_ids == ["a", "z"]
        assert result.per_query["include"] == 1

    def test_exclude_beats_include(self):
        result = self._discover(
            [payload(["a"])], nodes=[NODE_A], geometry="none",
            include=["z"], exclude=["z", "a"],
        )
        assert result.dataset_ids == []
        assert result.per_query["exclude"] == -2

    def test_areas_are_queried(self):
        result = self._discover([payload(["a"])], areas=["32"], geometry="none")
        assert result.per_query["area:32"] == 1

    def test_partial_failure_raises_and_returns_nothing(self, geo_filter):
        """Nodes succeed, geometry 400s -> must raise, never union the partial set.

        A partial union looks like a legitimate smaller list, and would let
        prune_stale_datasets delete hundreds of real datasets.
        """
        with pytest.raises(ObisDiscoveryError):
            self._discover(
                [payload(["a"]), payload(["b"]), requests.HTTPError("400")],
                geo_filter=geo_filter,
                nodes=[NODE_A, NODE_B],
            )

    def test_min_datasets_floor_raises_even_when_queries_succeed(self):
        with pytest.raises(ObisDiscoveryError, match="below the min_datasets floor"):
            ObisDatasetDiscovery(
                ObisDiscoveryConfig.from_config(
                    {"nodes": [NODE_A], "geometry": "none", "min_datasets": 700}
                ),
                session=fake_session([payload(["a", "b"])]),
            ).discover()

    def test_disabled_config_raises(self):
        with pytest.raises(ObisDiscoveryError, match="disabled"):
            ObisDatasetDiscovery(ObisDiscoveryConfig(enabled=False)).discover()

    def test_geometry_bytes_reported(self, geo_filter):
        result = self._discover([payload(["a"])], geo_filter=geo_filter)
        assert result.geometry_bytes > 0
        assert result.geometry_tolerance == 0.25

    def test_inline_wkt_geometry_used_verbatim(self):
        wkt = "POLYGON((-130 48, -120 48, -120 55, -130 55, -130 48))"
        d = ObisDatasetDiscovery(
            ObisDiscoveryConfig.from_config({"geometry": wkt, "min_datasets": 0}),
            session=fake_session([payload(["a"])]),
        )
        result = d.discover()
        assert d.session.get.call_args.kwargs["params"]["geometry"] == wkt
        assert result.geometry_tolerance is None

    def test_oversized_inline_wkt_raises(self):
        # A genuinely long (valid) WKT string: a many-vertex circle.
        big = TEST_POLYGON.buffer(2, quad_segs=200).wkt
        assert len(big.encode()) > 4500
        d = ObisDatasetDiscovery(
            ObisDiscoveryConfig.from_config({"geometry": big}),
            session=fake_session([]),
        )
        with pytest.raises(ObisDiscoveryError, match="over the .* byte limit"):
            d.discover()

    def test_invalid_inline_wkt_raises(self):
        d = ObisDatasetDiscovery(
            ObisDiscoveryConfig.from_config({"geometry": "NOT_WKT"}),
            session=fake_session([]),
        )
        with pytest.raises(ObisDiscoveryError, match="not valid WKT"):
            d.discover()

    def test_mode_none_geo_filter_still_gets_a_geometry(self, polygon_file):
        """Disabling occurrence clipping must not disable the discovery geometry."""
        gf = ObisGeoFilter(mode="none", polygon_file=polygon_file)
        assert gf.polygon is None
        result = self._discover([payload(["a"])], geo_filter=gf)
        assert result.geometry_bytes > 0
