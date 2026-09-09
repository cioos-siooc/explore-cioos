"""
Unit tests for cde_harvester.core.config.resolve_obis_config.

This is the single place that decides how OBIS datasets are selected. The three
config readers (CLI, Prefect init_config, fan-out flow) previously each parsed
the OBIS keys themselves and drifted — which is how obis_geo_filter ended up
silently ignored on the Prefect path.
"""

import json

import pytest

from cde_harvester.core.config import resolve_obis_config

NODE_A = "7dfb2d90-9317-434d-8d4e-64adf324579a"
IDS = ["4b5e4ccb-cf66-44e4-8890-fa68f8404c3f", "aaaaaaaa-0000-0000-0000-000000000000"]

DISCOVERY = {"enabled": True, "nodes": [NODE_A], "geometry": "eez"}


@pytest.fixture
def datasets_file(tmp_path):
    f = tmp_path / "Obis_Datasets.json"
    f.write_text(json.dumps({"datasets": IDS}))
    return str(f)


class TestModes:
    def test_off_when_nothing_configured(self):
        sel = resolve_obis_config({})
        assert sel.mode == "off"
        assert sel.dataset_ids == []
        assert sel.discovery is None

    def test_none_config_is_off(self):
        assert resolve_obis_config(None).mode == "off"

    def test_explicit_ids_win(self):
        sel = resolve_obis_config({"obis_dataset_ids": IDS})
        assert sel.mode == "ids"
        assert sel.dataset_ids == IDS
        assert sel.discovery is None

    def test_discovery_mode(self):
        sel = resolve_obis_config({"obis_discovery": DISCOVERY})
        assert sel.mode == "discovery"
        assert sel.dataset_ids == []
        assert sel.discovery == DISCOVERY

    def test_file_mode_loads_ids(self, datasets_file):
        sel = resolve_obis_config({"obis_datasets_file": datasets_file})
        assert sel.mode == "file"
        assert sel.dataset_ids == IDS

    def test_discovery_disabled_falls_through_to_file(self, datasets_file):
        sel = resolve_obis_config({
            "obis_discovery": {"enabled": False, "nodes": [NODE_A]},
            "obis_datasets_file": datasets_file,
        })
        assert sel.mode == "file"
        assert sel.dataset_ids == IDS

    def test_discovery_disabled_and_no_file_is_off(self):
        sel = resolve_obis_config({"obis_discovery": {"enabled": False}})
        assert sel.mode == "off"


class TestPrecedenceWarnings:
    def test_ids_bypass_discovery_with_warning(self, caplog):
        with caplog.at_level("WARNING"):
            sel = resolve_obis_config({
                "obis_dataset_ids": IDS,
                "obis_discovery": DISCOVERY,
            })
        assert sel.mode == "ids"
        assert sel.discovery is None
        assert "discovery is bypassed" in caplog.text

    def test_discovery_ignores_file_with_warning(self, caplog, datasets_file):
        # Unioning the legacy list back in would resurrect the datasets that
        # discovery deliberately drops.
        with caplog.at_level("WARNING"):
            sel = resolve_obis_config({
                "obis_discovery": DISCOVERY,
                "obis_datasets_file": datasets_file,
            })
        assert sel.mode == "discovery"
        assert sel.dataset_ids == []
        assert "is ignored because obis_discovery is enabled" in caplog.text


class TestOverrides:
    def test_cli_dataset_ids_override_config(self):
        sel = resolve_obis_config({"obis_discovery": DISCOVERY}, dataset_ids=["cli-id"])
        assert sel.mode == "ids"
        assert sel.dataset_ids == ["cli-id"]

    def test_cli_datasets_file_override(self, datasets_file):
        sel = resolve_obis_config({}, datasets_file=datasets_file)
        assert sel.mode == "file"
        assert sel.dataset_ids == IDS

    def test_discover_overlay_creates_discovery(self):
        sel = resolve_obis_config({}, discover={"enabled": True, "nodes": [NODE_A]})
        assert sel.mode == "discovery"
        assert sel.discovery["nodes"] == [NODE_A]

    def test_discover_overlay_merges_over_config_block(self):
        sel = resolve_obis_config(
            {"obis_discovery": {"enabled": True, "nodes": [NODE_A], "min_datasets": 700}},
            discover={"min_datasets": 0},
        )
        assert sel.discovery["nodes"] == [NODE_A]
        assert sel.discovery["min_datasets"] == 0


class TestGeoFilterBlock:
    def test_geo_filter_always_returned_as_dict(self):
        assert resolve_obis_config({}).geo_filter == {}

    def test_geo_filter_passed_through(self):
        cfg = {"mode": "none", "exempt_node_ids": [NODE_A]}
        assert resolve_obis_config({"obis_geo_filter": cfg}).geo_filter == cfg

    def test_geo_filter_returned_in_every_mode(self, datasets_file):
        cfg = {"mode": "canada"}
        for config in (
            {"obis_geo_filter": cfg},
            {"obis_geo_filter": cfg, "obis_dataset_ids": IDS},
            {"obis_geo_filter": cfg, "obis_discovery": DISCOVERY},
            {"obis_geo_filter": cfg, "obis_datasets_file": datasets_file},
        ):
            assert resolve_obis_config(config).geo_filter == cfg
