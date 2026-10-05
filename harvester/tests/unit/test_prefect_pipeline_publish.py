"""
Archiving harvest runs to CDE_PUBLISH_URL, and loading them back with the
"Load Harvest Run" flow.

The archive must never cost the site its data: publishing happens after the
load, a failed load is still archived (so it can be replayed), and a failed
publish only turns the run red once the load has already landed.
"""

import csv
import os

import pytest
import yaml
from cde_harvester import prefect_pipeline
from cde_harvester.core import publish
from cde_harvester.prefect_pipeline import PrefectCDEPipeline, _replay_check, cde_load_run
from fsspec.implementations.memory import MemoryFileSystem

BASE = "memory://cde/test"
SOURCE = "https://data.cioospacific.ca/erddap"
CHANGED = {"changed": True, "changed_datasets": 1, "pruned": 0, "gc": 0, "full_reload": False}
UNCHANGED = dict(CHANGED, changed=False, changed_datasets=0)
RUN_ROW = {
    "run_id": "0b17f762-bad3-4aed-b65b-6688a4b07c4a",
    "started_at": "2026-09-23 12:00:00+00:00",
    "status": "ok",
    "scope": "single",
    "triggered_source": SOURCE,
}
OPTIONAL_FILES = ("obis_cells.csv", "trajectory_days.csv", "trajectory_points.csv", "verified.csv")


@pytest.fixture(autouse=True)
def clean_memory_fs():
    MemoryFileSystem.store.clear()
    MemoryFileSystem.pseudo_dirs.clear()
    MemoryFileSystem.pseudo_dirs.append("")
    yield
    MemoryFileSystem.store.clear()


def _write_run(folder, extra=()):
    os.makedirs(folder, exist_ok=True)
    for name in ("datasets.csv", "profiles.csv", "skipped.csv", *extra):
        with open(os.path.join(folder, name), "w") as f:
            f.write("a,b\n1,2\n")
    with open(os.path.join(folder, "harvest_runs.csv"), "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(RUN_ROW))
        writer.writeheader()
        writer.writerow(RUN_ROW)


@pytest.fixture
def run_pipeline(tmp_path, monkeypatch):
    """Run cde_pipeline() for one source with harvest/load/redis stubbed.
    The steps it took are recorded, in order, in run_pipeline.events — also
    when the run raises."""
    monkeypatch.delenv("HARVEST_CONFIG_YAML", raising=False)
    monkeypatch.delenv("HARVEST_CONFIG_FILE", raising=False)
    events = []

    def _run(load=CHANGED, harvest_fails=False, publish_fails=False):
        events.clear()

        def harvester_main(folder, **kw):
            # Like the real harvester, which writes its run audit on the way out
            # of a failed run too.
            _write_run(folder)
            if harvest_fails:
                raise RuntimeError("harvest failed")

        def db_loader_main(folder, incremental):
            events.append("load")
            if isinstance(load, Exception):
                raise load
            return load

        real_publish = publish.publish_folder

        def publish_folder(local_dir, dest_url, **fields):
            events.append(("publish", dest_url, fields))
            if publish_fails:
                raise ConnectionError("bucket unreachable")
            return real_publish(local_dir, dest_url, **fields)

        monkeypatch.setattr(prefect_pipeline, "harvester_main", harvester_main)
        monkeypatch.setattr(prefect_pipeline, "db_loader_main", db_loader_main)
        monkeypatch.setattr(prefect_pipeline, "_prune_server_run_folders", lambda *a, **kw: None)
        monkeypatch.setattr(prefect_pipeline, "clearRedisCache", lambda: events.append("clear"))
        monkeypatch.setattr(prefect_pipeline, "reloadTopRequests", lambda: events.append("warm"))
        monkeypatch.setattr(prefect_pipeline.publish, "publish_folder", publish_folder)
        monkeypatch.setattr(
            prefect_pipeline.sentry_sdk, "capture_exception", lambda e: events.append(("sentry", str(e)))
        )

        config = tmp_path / "harvest_config.yaml"
        config.write_text(yaml.safe_dump({
            "erddap_urls": [SOURCE], "folder": str(tmp_path / "harvest"), "flush_redis": True,
        }))
        p = PrefectCDEPipeline()
        p.init_config(str(config))
        p.source = SOURCE
        p.cde_pipeline()
        return events

    _run.events = events
    return _run


class TestArchiveAfterLoad:
    def test_publishes_after_the_load_and_the_redis_refresh(self, run_pipeline, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        events = run_pipeline()

        assert [e if isinstance(e, str) else e[0] for e in events] == ["load", "clear", "warm", "publish"]
        _, url, fields = events[-1]
        assert url.startswith(f"{BASE}/runs/data-cioospacific-ca/")
        assert fields == {"kind": "run", "slug": "data-cioospacific-ca", "incremental": True}
        with publish.fetched(url) as (_, manifest):
            assert "harvest_runs.csv" in manifest["files"]

    def test_unset_url_publishes_nothing(self, run_pipeline):
        assert [e for e in run_pipeline() if e[0] == "publish"] == []

    def test_a_failed_load_is_still_archived_and_its_error_propagates(self, run_pipeline, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        with pytest.raises(RuntimeError, match="db down"):
            run_pipeline(load=RuntimeError("db down"))
        assert [e if isinstance(e, str) else e[0] for e in run_pipeline.events] == ["load", "publish"]
        assert MemoryFileSystem.store, "the run that failed to load was not archived"

    def test_a_failed_publish_keeps_the_load_then_fails_the_run(self, run_pipeline, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        with pytest.raises(RuntimeError, match="loaded but not archived"):
            run_pipeline(publish_fails=True)
        steps = [e if isinstance(e, str) else e[0] for e in run_pipeline.events]
        # Sentry sees it explicitly: Prefect swallows the flow's exception and
        # log records are only breadcrumbs.
        assert steps == ["load", "clear", "warm", "publish", "sentry"]

    def test_a_failed_harvest_publishes_nothing(self, run_pipeline, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        with pytest.raises(RuntimeError, match="harvest failed"):
            run_pipeline(harvest_fails=True)
        assert [e for e in run_pipeline.events if e[0] == "publish"] == []
        assert not MemoryFileSystem.store


@pytest.fixture
def published_run(tmp_path, monkeypatch):
    """Publish a run under BASE and return its URL."""
    monkeypatch.setenv("CDE_PUBLISH_URL", BASE)

    def _publish(kind="run", incremental=True):
        folder = tmp_path / "run"
        _write_run(folder, extra=OPTIONAL_FILES)
        url = f"{BASE}/runs/data-cioospacific-ca/20260923_120000"
        publish.publish_folder(folder, url, kind=kind, incremental=incremental)
        return url

    return _publish


@pytest.fixture
def load_run(monkeypatch):
    """Call the Load Harvest Run flow body with the loader and redis stubbed.

    `rows` are the database's answers to the replay guard's two queries (is the
    run loaded? is a newer one?); the guard itself runs for real against the
    fetched folder."""

    def _load(url, rows=(None, None), summary=CHANGED, **kwargs):
        calls = {"loads": [], "redis": []}

        def db_loader_main(folder, incremental):
            calls["loads"].append({"incremental": incremental, "files": sorted(os.listdir(folder))})
            return summary

        monkeypatch.setattr(prefect_pipeline.core_db, "create_db_engine", lambda: FakeEngine(*rows))
        monkeypatch.setattr(prefect_pipeline, "db_loader_main", db_loader_main)
        monkeypatch.setattr(prefect_pipeline, "clearRedisCache", lambda: calls["redis"].append("clear"))
        monkeypatch.setattr(prefect_pipeline, "reloadTopRequests", lambda: calls["redis"].append("warm"))
        calls["result"] = cde_load_run.fn(url, **kwargs)
        return calls

    return _load


class TestLoadHarvestRun:
    def test_the_loader_sees_every_file_the_harvester_wrote(self, published_run, load_run):
        # The regression this flow exists to avoid: a loader pointed at a remote
        # folder sees none of its optional files, and an incremental load then
        # deletes that data.
        calls = load_run(published_run())
        assert calls["loads"][0]["files"] == sorted(
            ["datasets.csv", "profiles.csv", "skipped.csv", "harvest_runs.csv", *OPTIONAL_FILES]
        )

    def test_mode_comes_from_the_manifest_unless_given(self, published_run, load_run):
        url = published_run(incremental=False)
        assert load_run(url)["loads"][0]["incremental"] is False
        assert load_run(url, incremental=True)["loads"][0]["incremental"] is True

    def test_redis_is_refreshed_only_when_the_load_changed_something(self, published_run, load_run):
        url = published_run()
        assert load_run(url)["redis"] == ["clear", "warm"]
        assert load_run(url, summary=UNCHANGED)["redis"] == []

    def test_a_run_from_another_databases_prefix_is_refused(self, published_run, load_run, monkeypatch):
        url = published_run()
        monkeypatch.setenv("CDE_PUBLISH_URL", "memory://cde/production")
        with pytest.raises(ValueError, match="not under this database"):
            load_run(url)
        assert load_run(url, force=True)["loads"]

    def test_a_snapshot_is_refused(self, published_run, load_run):
        with pytest.raises(ValueError, match="snapshot"):
            load_run(published_run(kind="snapshot"))

    def test_an_already_loaded_run_is_a_no_op_even_when_forced(self, published_run, load_run):
        calls = load_run(published_run(), rows=((1,),), force=True)
        assert calls["loads"] == []
        assert calls["result"]["changed"] is False

    def test_an_older_delta_is_refused_unless_forced(self, published_run, load_run):
        url = published_run()
        with pytest.raises(RuntimeError, match="Refusing to load"):
            load_run(url, rows=(None, Newer()))
        assert load_run(url, rows=(None, Newer()), force=True)["loads"]


class FakeResult:
    def __init__(self, row):
        self.row = row

    def first(self):
        return self.row


class Newer:
    run_id = "later"
    started_at = "2026-09-24"


class FakeConnection:
    def __init__(self, rows):
        self.rows = list(rows)
        self.params = []
        self.sql = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params):
        self.sql.append(" ".join(str(statement).split()))
        self.params.append(params)
        return FakeResult(self.rows.pop(0))


class FakeEngine:
    def __init__(self, *rows):
        self.connection = FakeConnection(rows)

    def connect(self):
        return self.connection

    def dispose(self):
        pass


class TestReplayCheck:
    @pytest.fixture
    def folder(self, tmp_path):
        _write_run(tmp_path)
        return tmp_path

    def test_a_folder_without_a_run_audit_is_not_checked(self, tmp_path):
        assert _replay_check(None, tmp_path) is None

    def test_a_known_run_id_is_skipped(self, folder):
        assert _replay_check(FakeEngine((1,)), folder)[0] == "skip"

    def test_a_newer_run_for_the_same_source_refuses(self, folder):
        engine = FakeEngine(None, Newer())
        verdict, reason = _replay_check(engine, folder)
        assert verdict == "refuse" and "later" in reason
        assert engine.connection.params[1] == {
            "started_at": RUN_ROW["started_at"], "scope": "single", "source": SOURCE,
        }
        # Only a successful run is "loaded", and only one covering this source.
        newer_sql = engine.connection.sql[1]
        assert "status = 'ok'" in newer_sql
        assert "started_at > CAST(:started_at AS timestamptz)" in newer_sql
        assert "(scope = 'full' OR :scope = 'full' OR triggered_source = :source)" in newer_sql

    def test_the_newest_run_loads(self, folder):
        assert _replay_check(FakeEngine(None, None), folder) is None


@pytest.fixture
def harvest_all(tmp_path, monkeypatch):
    """Run the Harvest All Sources body with the children and the snapshot stubbed."""
    monkeypatch.delenv("HARVEST_CONFIG_YAML", raising=False)
    monkeypatch.delenv("HARVEST_CONFIG_FILE", raising=False)
    events = []

    def _run(child_ok=True, snapshot_fails=False, empty=False):
        class Future:
            def __init__(self, source):
                self.source = source

            def result(self):
                events.append("child")
                return {"source": self.source, "deployment": "d", "flow_run_id": "x",
                        "state": "COMPLETED" if child_ok else "FAILED", "completed": child_ok,
                        "error": None if child_ok else "final state FAILED"}

        def take_snapshot(engine, url):
            events.append(("snapshot", url))
            if snapshot_fails:
                raise ConnectionError("bucket unreachable")

        monkeypatch.setattr(prefect_pipeline._trigger_source_harvest, "submit",
                            lambda src, by: Future(src), raising=False)
        monkeypatch.setattr(prefect_pipeline.snapshot, "take_snapshot", take_snapshot)
        monkeypatch.setattr(prefect_pipeline.core_db, "database_is_empty", lambda: empty)
        monkeypatch.setattr(prefect_pipeline.core_db, "create_db_engine",
                            lambda: type("E", (), {"dispose": lambda self: None})())
        monkeypatch.setattr(prefect_pipeline.sentry_sdk, "capture_exception",
                            lambda e: events.append("sentry"))
        config = tmp_path / "harvest_config.yaml"
        config.write_text(yaml.safe_dump({"erddap_urls": [SOURCE]}))
        prefect_pipeline.cde_harvest_all_run.fn(str(config))

    _run.events = events
    return _run


class TestHarvestAllSnapshot:
    def test_snapshots_after_every_child_finished(self, harvest_all, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        harvest_all()
        assert harvest_all.events[0] == "child"
        assert harvest_all.events[1][1].startswith(f"{BASE}/snapshots/")

    def test_an_empty_database_is_not_published(self, harvest_all, monkeypatch):
        # It would become the "latest" snapshot a fresh volume restores from.
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        harvest_all(empty=True)
        assert harvest_all.events == ["child"]

    def test_no_url_takes_no_snapshot(self, harvest_all):
        harvest_all()
        assert harvest_all.events == ["child"]

    def test_a_failed_snapshot_fails_the_run_and_alerts(self, harvest_all, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        with pytest.raises(RuntimeError, match="the snapshot failed"):
            harvest_all(snapshot_fails=True)
        assert harvest_all.events[-1] == "sentry"

    def test_failed_sources_still_get_a_snapshot_and_both_are_reported(self, harvest_all, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", BASE)
        with pytest.raises(RuntimeError, match="did not complete.*the snapshot also failed"):
            harvest_all(child_ok=False, snapshot_fails=True)
        assert [e[0] for e in harvest_all.events if isinstance(e, tuple)] == ["snapshot"]
