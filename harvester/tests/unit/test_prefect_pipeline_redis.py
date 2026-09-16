"""
The redis cache-flush gate in cde_harvester.prefect_pipeline.

A harvest used to drop the whole cache on every run, whether or not the load
changed anything. In production every run is incremental, so a run where every
dataset hashed unchanged still wiped redis — and the next visitor paid to
rebuild responses that were byte-for-byte what had just been thrown away.
The load now reports what it did, and the flush is gated on it.
"""

import pytest
import yaml

from cde_harvester import prefect_pipeline
from cde_harvester.prefect_pipeline import PrefectCDEPipeline

BASE_CONFIG = {
    "erddap_urls": ["https://data.cioospacific.ca/erddap"],
    "folder": "harvest",
    "flush_redis": True,
}

UNCHANGED = {
    "changed": False,
    "changed_datasets": 0,
    "pruned": 0,
    "gc": 0,
    "full_reload": False,
}
CHANGED = {
    "changed": True,
    "changed_datasets": 4,
    "pruned": 0,
    "gc": 0,
    "full_reload": False,
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


@pytest.fixture
def run_pipeline(config_file, tmp_path, monkeypatch):
    """Run cde_pipeline() with everything but the redis step stubbed out.
    Returns the list of cache calls it made, in order."""

    def _run(load_summary, **config_overrides):
        calls = []
        monkeypatch.setattr(prefect_pipeline, "harvester_main", lambda **kw: None)
        monkeypatch.setattr(prefect_pipeline, "db_loader_main", lambda **kw: load_summary)
        monkeypatch.setattr(prefect_pipeline, "_prune_server_run_folders", lambda *a, **kw: None)
        monkeypatch.setattr(prefect_pipeline, "clearRedisCache", lambda: calls.append("clear"))
        monkeypatch.setattr(prefect_pipeline, "reloadTopRequests", lambda: calls.append("warm"))

        config = dict(BASE_CONFIG, folder=str(tmp_path / "harvest"), **config_overrides)
        p = PrefectCDEPipeline()
        p.init_config(config_file(config))
        p.cde_pipeline()
        return calls

    return _run


class TestRedisFlushGate:
    def test_unchanged_load_keeps_the_cache(self, run_pipeline):
        # The whole point: a no-op harvest must not cost the next visitor a
        # cold cache.
        assert run_pipeline(UNCHANGED) == []

    def test_changed_load_flushes_and_rewarms(self, run_pipeline):
        # Order matters — warming before the flush would populate entries the
        # flush then deletes.
        assert run_pipeline(CHANGED) == ["clear", "warm"]

    def test_flush_redis_off_never_touches_the_cache(self, run_pipeline):
        assert run_pipeline(CHANGED, flush_redis=False) == []
