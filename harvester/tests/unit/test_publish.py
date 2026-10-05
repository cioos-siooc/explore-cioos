"""
cde_harvester.core.publish: archiving run folders to object storage and
fetching them back for the loader.

The loader only ever reads a local folder, and it treats an optional file it
cannot see as "no data" — which in incremental mode deletes that data. So what
matters here is that a fetched run is byte-for-byte the folder that was
published, and that anything short of a complete, verified upload is refused
rather than handed over partially.
"""

import gzip
import json
import os
from pathlib import Path

import fsspec
import pytest
from cde_harvester.core import publish
from fsspec.implementations.memory import MemoryFileSystem

AWS_VARS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")

RUN_FILES = {
    "datasets.csv": "erddap_url,dataset_id\nhttps://x/erddap,ds1\n",
    # The loader skips profiles.csv when it is a single byte; that byte must survive.
    "profiles.csv": "\n",
    "skipped.csv": "erddap_url,dataset_id,reason_code\n",
    "verified.csv": "erddap_url,dataset_id,verified_at\nhttps://x/erddap,ds2,2026-09-23\n",
    "harvest_runs.csv": "run_id,started_at\n1,2026-09-23\n",
}


@pytest.fixture(autouse=True)
def clean_memory_fs():
    MemoryFileSystem.store.clear()
    MemoryFileSystem.pseudo_dirs.clear()
    MemoryFileSystem.pseudo_dirs.append("")
    yield
    MemoryFileSystem.store.clear()


@pytest.fixture
def run_folder(tmp_path):
    folder = tmp_path / "erddap-x" / "20260923_120000"
    folder.mkdir(parents=True)
    for name, body in RUN_FILES.items():
        (folder / name).write_text(body)
    return folder


def _local_files(folder):
    return {name: (folder / name).read_bytes() for name in os.listdir(folder)}


class TestPublishUrl:
    def test_unset_or_blank_means_no_publishing(self, monkeypatch):
        assert publish.publish_url() is None
        monkeypatch.setenv("CDE_PUBLISH_URL", "  ")
        assert publish.publish_url() is None

    def test_trailing_slash_is_dropped(self, monkeypatch):
        monkeypatch.setenv("CDE_PUBLISH_URL", "s3://bucket/production/")
        assert publish.publish_url() == "s3://bucket/production"

    @pytest.mark.parametrize("url", ["s3://bucket", "s3://bucket/", "/srv/archive", "archive"])
    def test_a_url_without_a_per_database_prefix_is_refused(self, monkeypatch, url):
        # Runs are deltas against one database; a bare bucket would let two
        # databases load each other's runs.
        monkeypatch.setenv("CDE_PUBLISH_URL", url)
        with pytest.raises(ValueError, match="per-database prefix"):
            publish.publish_url()


class TestRoundTrip:
    def test_fetched_run_is_the_published_folder_byte_for_byte(self, run_folder):
        (run_folder / "spill").mkdir()
        (run_folder / "spill" / "ignored.csv").write_text("not part of the run\n")

        publish.publish_folder(run_folder, "memory://cde/test/runs/erddap-x/1", kind="run")

        with publish.fetched("memory://cde/test/runs/erddap-x/1") as (folder, manifest):
            fetched = _local_files(Path(folder))
        expected = {name: body.encode() for name, body in RUN_FILES.items()}
        assert fetched == expected
        assert set(manifest["files"]) == set(RUN_FILES)

    def test_manifest_records_fields_and_uncompressed_sizes(self, run_folder):
        manifest = publish.publish_folder(
            run_folder, "memory://cde/test/r", kind="run", slug="erddap-x", incremental=True
        )
        assert manifest["layout"] == publish.LAYOUT
        assert (manifest["kind"], manifest["slug"], manifest["incremental"]) == ("run", "erddap-x", True)
        assert manifest["files"]["profiles.csv"]["bytes"] == 1
        stored = json.loads(fsspec.filesystem("memory").cat_file("/cde/test/r/_manifest.json"))
        assert stored == manifest

    def test_file_backend_writes_gzipped_objects(self, run_folder, tmp_path):
        dest = tmp_path / "archive" / "dev" / "runs" / "erddap-x" / "1"
        publish.publish_folder(run_folder, f"file://{dest}", kind="run")

        assert sorted(os.listdir(dest)) == sorted([f"{n}.gz" for n in RUN_FILES] + ["_manifest.json"])
        assert gzip.decompress((dest / "datasets.csv.gz").read_bytes()) == RUN_FILES["datasets.csv"].encode()

    def test_manifest_is_written_last(self, run_folder, monkeypatch):
        writes = []
        real = MemoryFileSystem.pipe_file
        monkeypatch.setattr(
            MemoryFileSystem, "pipe_file",
            lambda self, path, value, **kw: (writes.append(path), real(self, path, value, **kw)),
        )
        publish.publish_folder(run_folder, "memory://cde/test/r")
        assert writes[-1].endswith("_manifest.json")
        assert len(writes) == len(RUN_FILES) + 1

    def test_an_empty_folder_is_never_published(self, tmp_path):
        with pytest.raises(FileNotFoundError, match="No CSV files"):
            publish.publish_folder(tmp_path, "memory://cde/test/r")
        assert not fsspec.filesystem("memory").exists("/cde/test/r/_manifest.json")


class TestFetchedRefuses:
    def test_a_prefix_without_a_manifest(self, run_folder):
        publish.publish_folder(run_folder, "memory://cde/test/r")
        fsspec.filesystem("memory").rm("/cde/test/r/_manifest.json")
        with pytest.raises(FileNotFoundError, match="upload never finished"), publish.fetched(
            "memory://cde/test/r"
        ):
            pass

    def test_a_file_that_does_not_match_its_checksum(self, run_folder):
        publish.publish_folder(run_folder, "memory://cde/test/r")
        fsspec.filesystem("memory").pipe_file("/cde/test/r/datasets.csv.gz", gzip.compress(b"tampered\n"))
        with pytest.raises(ValueError, match="checksum"), publish.fetched("memory://cde/test/r"):
            pass

    def test_a_manifest_naming_a_file_outside_the_prefix(self, run_folder):
        publish.publish_folder(run_folder, "memory://cde/test/r")
        fs = fsspec.filesystem("memory")
        manifest = json.loads(fs.cat_file("/cde/test/r/_manifest.json"))
        manifest["files"]["../escape.csv"] = manifest["files"]["datasets.csv"]
        fs.pipe_file("/cde/test/r/_manifest.json", json.dumps(manifest).encode())
        with pytest.raises(ValueError, match="outside the prefix"), publish.fetched("memory://cde/test/r"):
            pass


class TestFetchedFolderLifetime:
    def test_a_plain_path_is_passed_through_untouched(self, run_folder):
        before = _local_files(run_folder)
        with publish.fetched(str(run_folder)) as (folder, manifest):
            assert (folder, manifest) == (str(run_folder), None)
        assert _local_files(run_folder) == before

    def test_the_temporary_copy_is_removed_on_exit_and_on_error(self, run_folder):
        publish.publish_folder(run_folder, "memory://cde/test/r")
        with publish.fetched("memory://cde/test/r") as (folder, _):
            pass
        assert not os.path.exists(folder)

        with pytest.raises(RuntimeError), publish.fetched("memory://cde/test/r") as (folder, _):
            raise RuntimeError("load failed")
        assert not os.path.exists(folder)


class TestS3:
    def test_missing_credentials_fail_before_any_network_call(self, monkeypatch, run_folder):
        for var in AWS_VARS:
            monkeypatch.delenv(var, raising=False)
        with pytest.raises(RuntimeError, match="needs S3 credentials"):
            publish.publish_folder(run_folder, "s3://bucket/production/runs/x/1")

    @pytest.mark.parametrize("url", ["file:///tmp/out", "memory://pub/x"])
    def test_credentials_are_only_checked_for_s3(self, monkeypatch, url):
        for var in AWS_VARS:
            monkeypatch.delenv(var, raising=False)
        publish.check_credentials(url)

    def test_s3_uses_path_style_bounded_timeouts_and_never_makedirs(self, monkeypatch, run_folder):
        # s3fs's makedirs creates the bucket when it cannot see one, and a
        # revoked key looks exactly like that on Juno.
        calls = []

        class RecordingFS:
            def makedirs(self, path, exist_ok=False):
                calls.append(("makedirs", path))

            def pipe_file(self, path, value, **kwargs):
                calls.append(("pipe_file", path, kwargs))

        def url_to_fs(url, **kwargs):
            calls.append(("url_to_fs", kwargs))
            return RecordingFS(), "bucket/production/runs/x/1"

        for var in AWS_VARS:
            monkeypatch.setenv(var, "x")
        monkeypatch.setattr(fsspec.core, "url_to_fs", url_to_fs)

        publish.publish_folder(run_folder, "s3://bucket/production/runs/x/1")

        config = calls[0][1]["config_kwargs"]
        assert config["s3"] == {"addressing_style": "path"}
        assert config["connect_timeout"] and config["read_timeout"]
        assert not [c for c in calls if c[0] == "makedirs"]
        assert calls[-1][:2] == ("pipe_file", "bucket/production/runs/x/1/_manifest.json")
        # read_timeout does not bound a PUT (Expect: 100-continue), so every
        # call carries its own wall-clock ceiling.
        assert all(c[2] == {"timeout": publish._S3_CALL_TIMEOUT} for c in calls if c[0] == "pipe_file")
