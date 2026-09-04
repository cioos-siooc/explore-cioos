"""
Regression tests for the OBIS wiring in cde_harvester.prefect_pipeline.

Two real bugs are pinned here:

  1. `cde_pipeline()` never passed `obis_geo_filter` to `harvester_main`, so the
     documented config block was silently ignored on the Prefect (production)
     path. `test_cde_pipeline_passes_obis_geo_filter_and_discovery` is the test
     that would have caught it.
  2. Deployment registration and the fan-out source list both gated on a
     non-empty `obis_dataset_ids`. Under discovery that list is empty at config
     time, so OBIS would silently stop being harvested.
"""

import textwrap

import pytest
import yaml

from cde_harvester import prefect_pipeline
from cde_harvester.prefect_pipeline import PrefectCDEPipeline, _configured_sources

NODE_A = "7dfb2d90-9317-434d-8d4e-64adf324579a"
NODE_B = "68f83ea7-69a7-44fd-be77-3c3afd6f3cf8"

DISCOVERY_CONFIG = {
    "erddap_urls": ["https://data.cioospacific.ca/erddap"],
    "folder": "harvest",
    "obis_discovery": {"enabled": True, "nodes": [NODE_A, NODE_B], "geometry": "eez"},
    "obis_geo_filter": {"mode": "canada", "exempt_node_ids": [NODE_A, NODE_B]},
}


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    # resolve_harvest_config_file() prefers these env vars over the passed path,
    # and .env sets HARVEST_CONFIG_FILE in a dev checkout.
    monkeypatch.delenv("HARVEST_CONFIG_YAML", raising=False)
    monkeypatch.delenv("HARVEST_CONFIG_FILE", raising=False)

    def _write(config):
        f = tmp_path / "harvest_config.yaml"
        f.write_text(yaml.safe_dump(config))
        return str(f)
    return _write


# ---------------------------------------------------------------------------
# _configured_sources
# ---------------------------------------------------------------------------

class TestConfiguredSources:
    def test_includes_obis_under_discovery_with_no_ids(self):
        sources = _configured_sources(
            "https://a.example/erddap", [], {"enabled": True, "nodes": [NODE_A]},
        )
        assert sources == ["https://a.example/erddap", "obis"]

    def test_includes_obis_for_explicit_ids(self):
        assert _configured_sources("", ["some-uuid"], None) == ["obis"]

    def test_excludes_obis_when_off(self):
        assert _configured_sources("https://a.example/erddap", [], None) == [
            "https://a.example/erddap"
        ]

    def test_excludes_obis_when_discovery_disabled(self):
        assert _configured_sources("", [], {"enabled": False, "nodes": [NODE_A]}) == []

    def test_accepts_a_list_of_urls(self):
        # cde_harvest_all_run passes the raw YAML list, create_deployment a string.
        assert _configured_sources(
            ["https://a.example/erddap", " https://b.example/erddap "], [], None
        ) == ["https://a.example/erddap", "https://b.example/erddap"]

    def test_empty_when_nothing_configured(self):
        assert _configured_sources("", [], None) == []


# ---------------------------------------------------------------------------
# init_config
# ---------------------------------------------------------------------------

class TestInitConfig:
    def test_discovery_config_leaves_dataset_ids_empty(self, config_file):
        p = PrefectCDEPipeline()
        p.init_config(config_file(DISCOVERY_CONFIG))
        assert p.obis_dataset_ids == []
        assert p.obis_discovery["enabled"] is True
        assert p.obis_geo_filter["mode"] == "canada"

    def test_makes_no_network_calls(self, config_file, monkeypatch):
        """init_config also runs at deployment-registration time, so a network
        call here would make container startup depend on api.obis.org."""
        def explode(*args, **kwargs):
            raise AssertionError("init_config must not make network calls")

        monkeypatch.setattr("requests.get", explode)
        monkeypatch.setattr("requests.Session.get", explode)

        p = PrefectCDEPipeline()
        p.init_config(config_file(DISCOVERY_CONFIG))
        assert p.obis_discovery is not None

    def test_typo_in_discovery_block_fails_at_registration(self, config_file):
        """A malformed OBIS block must fail here, not at the first harvest."""
        bad = dict(DISCOVERY_CONFIG,
                   obis_discovery={"enabled": True, "nodes": [NODE_A], "min_dataset": 5})
        with pytest.raises(ValueError, match="Unknown obis_discovery key"):
            PrefectCDEPipeline().init_config(config_file(bad))

    def test_typo_in_geo_filter_block_fails_at_registration(self, config_file):
        bad = dict(DISCOVERY_CONFIG, obis_geo_filter={"modes": "canada"})
        with pytest.raises(ValueError, match="Unknown obis_geo_filter key"):
            PrefectCDEPipeline().init_config(config_file(bad))

    def test_legacy_file_config_still_loads_ids(self, config_file, tmp_path):
        ids_file = tmp_path / "Obis_Datasets.json"
        ids_file.write_text('{"datasets": ["uuid-one", "uuid-two"]}')
        p = PrefectCDEPipeline()
        p.init_config(config_file({
            "erddap_urls": [],
            "obis_datasets_file": str(ids_file),
        }))
        assert p.obis_dataset_ids == ["uuid-one", "uuid-two"]
        assert p.obis_discovery is None


# ---------------------------------------------------------------------------
# cde_pipeline -> harvester_main
# ---------------------------------------------------------------------------

class TestCdePipelineWiring:
    def test_cde_pipeline_passes_obis_geo_filter_and_discovery(
        self, config_file, tmp_path, monkeypatch
    ):
        captured = {}

        def fake_harvester_main(**kwargs):
            captured.update(kwargs)

        monkeypatch.setattr(prefect_pipeline, "harvester_main", fake_harvester_main)
        monkeypatch.setattr(prefect_pipeline, "db_loader_main", lambda **kw: None)
        monkeypatch.setattr(prefect_pipeline, "_prune_server_run_folders", lambda *a, **kw: None)

        config = dict(DISCOVERY_CONFIG, folder=str(tmp_path / "harvest"))
        p = PrefectCDEPipeline()
        p.init_config(config_file(config))
        p.cde_pipeline()

        # The bug: neither of these was ever passed.
        assert captured["obis_geo_filter"] == {
            "mode": "canada", "exempt_node_ids": [NODE_A, NODE_B],
        }
        assert captured["obis_discovery"]["enabled"] is True
        assert captured["obis_dataset_ids"] == []


# ---------------------------------------------------------------------------
# cde_harvest_all_run fan-out
# ---------------------------------------------------------------------------

class TestFanOut:
    def test_obis_in_fanout_under_discovery(self, config_file, monkeypatch):
        triggered = []

        class FakeFuture:
            def __init__(self, source):
                self.source = source

            def result(self):
                return {"source": self.source, "deployment": "d", "state": "COMPLETED",
                        "completed": True, "flow_run_id": "x"}

        def fake_submit(src, triggered_by):
            triggered.append(src)
            return FakeFuture(src)

        monkeypatch.setattr(
            prefect_pipeline._trigger_source_harvest, "submit", fake_submit, raising=False
        )
        prefect_pipeline.cde_harvest_all_run.fn(config_file(DISCOVERY_CONFIG))
        assert triggered == ["https://data.cioospacific.ca/erddap", "obis"]

    def test_no_sources_raises(self, config_file):
        with pytest.raises(ValueError, match="No sources configured"):
            prefect_pipeline.cde_harvest_all_run.fn(config_file({"erddap_urls": []}))
