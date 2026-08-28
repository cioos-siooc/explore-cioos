"""
Unit tests for the discovery hook in cde_harvester.sources.obis.harvester.

Covers the handoff between discovery and the harvester, and the guard that stops
an empty dataset list from looking like "OBIS has no data" (which would let the
db-loader prune every OBIS dataset out of the database).
"""

from unittest.mock import MagicMock

import pytest

from cde_harvester.sources.obis import harvester as obis_harvester
from cde_harvester.sources.obis.discovery import (
    DiscoveryResult,
    ObisDiscoveryConfig,
    ObisDiscoveryError,
)
from cde_harvester.sources.obis.harvester import OBISHarvester, harvest_obis

NODE_A = "7dfb2d90-9317-434d-8d4e-64adf324579a"
DISCOVERY = ObisDiscoveryConfig.from_config(
    {"enabled": True, "nodes": [NODE_A], "geometry": "none", "min_datasets": 0}
)


@pytest.fixture
def stub_harvester(monkeypatch):
    """Replace OBISHarvester so tests exercise only the discovery handoff."""
    created = {}

    class FakeHarvester:
        def __init__(self, limit_dataset_ids, folder, prefect_logger=None,
                     geo_filter=None, run_id=None):
            created["ids"] = limit_dataset_ids
            created["folder"] = folder
            created["geo_filter"] = geo_filter

        def harvest(self):
            return "harvest-result"

    monkeypatch.setattr(obis_harvester, "OBISHarvester", FakeHarvester)
    return created


@pytest.fixture
def no_artifact(monkeypatch):
    monkeypatch.setattr(obis_harvester, "_publish_discovery_artifact", lambda *a: None)


def fake_discovery_class(monkeypatch, result=None, error=None):
    """Patch ObisDatasetDiscovery; returns a dict recording construction."""
    seen = {"constructed": 0}

    class FakeDiscovery:
        def __init__(self, config, geo_filter=None, logger=None, session=None):
            seen["constructed"] += 1
            seen["config"] = config
            seen["geo_filter"] = geo_filter

        def discover(self):
            if error:
                raise error
            return result

    monkeypatch.setattr(obis_harvester, "ObisDatasetDiscovery", FakeDiscovery)
    return seen


class TestHarvestObisDiscovery:
    def test_discovered_ids_are_passed_to_the_harvester(
        self, monkeypatch, stub_harvester, no_artifact
    ):
        seen = fake_discovery_class(
            monkeypatch,
            result=DiscoveryResult(dataset_ids=["a", "b", "c"], per_query={"node:x": 3}),
        )
        assert harvest_obis.fn(discovery=DISCOVERY) == "harvest-result"
        assert seen["constructed"] == 1
        assert stub_harvester["ids"] == ["a", "b", "c"]

    def test_explicit_ids_bypass_discovery_entirely(
        self, monkeypatch, stub_harvester, no_artifact
    ):
        seen = fake_discovery_class(monkeypatch, result=DiscoveryResult(dataset_ids=["z"]))
        harvest_obis.fn(limit_dataset_ids=["given-1", "given-2"], discovery=DISCOVERY)
        assert seen["constructed"] == 0
        assert stub_harvester["ids"] == ["given-1", "given-2"]

    def test_disabled_discovery_is_not_constructed(
        self, monkeypatch, stub_harvester, no_artifact
    ):
        seen = fake_discovery_class(monkeypatch, result=DiscoveryResult(dataset_ids=["z"]))
        harvest_obis.fn(discovery=ObisDiscoveryConfig(enabled=False))
        assert seen["constructed"] == 0
        # No ids resolved at all; the real OBISHarvester raises on that (see
        # TestEmptyDatasetListGuard) rather than silently harvesting nothing.
        assert not stub_harvester["ids"]

    def test_discovery_error_propagates(self, monkeypatch, stub_harvester, no_artifact):
        """Must propagate so the task fails and cde_pipeline never reaches the
        db-loader — a failed discovery must not prune anything."""
        fake_discovery_class(monkeypatch, error=ObisDiscoveryError("OBIS is down"))
        with pytest.raises(ObisDiscoveryError, match="OBIS is down"):
            harvest_obis.fn(discovery=DISCOVERY)

    def test_geo_filter_is_shared_with_discovery(
        self, monkeypatch, stub_harvester, no_artifact
    ):
        seen = fake_discovery_class(monkeypatch, result=DiscoveryResult(dataset_ids=["a"]))
        gf = MagicMock()
        harvest_obis.fn(discovery=DISCOVERY, geo_filter=gf)
        assert seen["geo_filter"] is gf
        assert stub_harvester["geo_filter"] is gf

    def test_default_geo_filter_built_when_omitted(
        self, monkeypatch, stub_harvester, no_artifact
    ):
        fake_discovery_class(monkeypatch, result=DiscoveryResult(dataset_ids=["a"]))
        harvest_obis.fn(discovery=DISCOVERY)
        assert stub_harvester["geo_filter"].mode == "canada"


class TestEmptyDatasetListGuard:
    def test_harvest_with_no_ids_raises(self):
        with pytest.raises(ValueError, match="no dataset ids"):
            OBISHarvester(limit_dataset_ids=[]).harvest()

    def test_harvest_with_none_ids_raises(self):
        with pytest.raises(ValueError, match="no dataset ids"):
            OBISHarvester(limit_dataset_ids=None).harvest()
