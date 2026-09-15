from cde_harvester.core.source_cache import source_cache_path


def test_uses_legacy_path_without_shared_cache_env(monkeypatch):
    monkeypatch.delenv("HARVEST_SOURCE_CACHE_DIR", raising=False)
    assert source_cache_path("erddap-v1", "harvester_cache") == "harvester_cache"


def test_places_source_cache_beneath_configured_root(monkeypatch):
    monkeypatch.setenv("HARVEST_SOURCE_CACHE_DIR", "/cache")
    assert source_cache_path("ckan-erddap-v1", "ckan_harvester_cache") == "/cache/ckan-erddap-v1"
