"""
cde_harvester.loading.snapshot: exporting the database into a folder the loader
can load as-is, and restoring the tables no load can rebuild.

A restore runs after "Rebuild Database" has already dropped the schema, so a
snapshot the loader cannot read is an empty site. The round-trip tests feed
the export values shaped exactly as psycopg2/pandas return them and read the
result back through the loader's own parsers.
"""

import ast
import datetime
import uuid
from pathlib import Path

import pandas as pd
import pytest
from cde_harvester.core import publish
from cde_harvester.core.day_sets import ranges_from_psycopg
from cde_harvester.loading import snapshot
from cde_harvester.loading.loader import parse_day_ranges, prepare_profiles_dataframe
from fsspec.implementations.memory import MemoryFileSystem
from psycopg2.extras import DateRange

D = datetime.date


@pytest.fixture(autouse=True)
def clean_memory_fs():
    MemoryFileSystem.store.clear()
    MemoryFileSystem.pseudo_dirs.clear()
    MemoryFileSystem.pseudo_dirs.append("")
    yield
    MemoryFileSystem.store.clear()


def test_ranges_from_psycopg():
    ranges = [DateRange(D(2020, 1, 1), D(2020, 1, 5), "[)"), DateRange(empty=True)]
    assert ranges_from_psycopg(ranges) == [(D(2020, 1, 1), D(2020, 1, 5))]
    assert ranges_from_psycopg(None) is None


# ---------------------------------------------------------------------------
# export_snapshot, against a fake connection that answers like Postgres
# ---------------------------------------------------------------------------

DATASETS = pd.DataFrame({
    "title": ["Buoy"],
    "erddap_url": ["https://x/erddap"],
    "dataset_id": ["ds1"],
    "eovs": [["seaSurfaceTemperature"]],
    "organizations": [["DFO"]],
    "profile_variables": [[]],
    "content_hash": ["abc"],
    "verified_at": [pd.Timestamp("2026-09-23 12:00", tz="UTC")],
    "table_variables": [[{"name": "temp", "cf_role": None, "is_depth": True}]],
    "obis_nodes": [[]],
})
PROFILES = pd.DataFrame({
    "erddap_url": ["https://x/erddap"],
    "dataset_id": ["ds1"],
    "timeseries_id": ["S1"],
    "profile_id": [""],
    "latitude": [48.5],
    "longitude": [-125.0],
    "time_min": [pd.Timestamp("2020-01-01", tz="UTC")],
    "time_max": [pd.Timestamp("2020-01-10", tz="UTC")],
    "day_ranges": [[DateRange(D(2020, 1, 1), D(2020, 1, 4), "[)"), DateRange(D(2020, 1, 8), D(2020, 1, 11), "[)")]],
    "eovs": [["seaSurfaceTemperature"]],
})
HARVEST_RUNS = pd.DataFrame({
    "run_id": [uuid.UUID("0b17f762-bad3-4aed-b65b-6688a4b07c4a")],
    "started_at": [pd.Timestamp("2026-09-23 12:00", tz="UTC")],
    "status": ["ok"],
})

# The old-schema database: no trajectory tables, and profiles without day_ranges/eovs.
TABLES = {
    "datasets": DATASETS,
    "profiles": PROFILES,
    "skipped_datasets": pd.DataFrame(columns=["erddap_url", "dataset_id", "reason_code"]),
    "obis_cells": pd.DataFrame(columns=["dataset_id", "latitude", "longitude", "scientific_names"]),
    "harvest_runs": HARVEST_RUNS,
}


class FakeCursor:
    def __init__(self):
        self.copies = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def copy_expert(self, sql, f):
        self.copies.append(sql)
        f.write("pk,dataset_id,erddap_url\n7,ds1,https://x/erddap\n")


class FakeConnection:
    def __init__(self, present):
        self.present = present
        self.queries = []
        self.copy_cursor = FakeCursor()
        self.connection = self

    def cursor(self):
        return self.copy_cursor

    def execution_options(self, **kw):
        self.options = kw
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement):
        return [(t, c) for t, cols in self.present.items() for c in cols]


class FakeEngine:
    def __init__(self, present):
        self.conn = FakeConnection(present)

    def connect(self):
        return self.conn


@pytest.fixture
def export(tmp_path, monkeypatch):
    present = {table: set(df.columns) for table, df in TABLES.items()}
    present["datasets_lookup"] = {"pk", "dataset_id", "erddap_url"}
    engine = FakeEngine(present)

    def read_sql(statement, conn):
        sql = str(statement)
        conn.queries.append(sql)
        table = sql.rsplit("FROM cde.", 1)[1].strip()
        return TABLES[table].copy()

    monkeypatch.setattr(snapshot.pd, "read_sql", read_sql)
    tables = snapshot.export_snapshot(engine, tmp_path)
    return tmp_path, tables, engine.conn


class TestExport:
    def test_reads_everything_in_one_repeatable_read_transaction(self, export):
        _, _, conn = export
        assert conn.options == {"isolation_level": "REPEATABLE READ", "postgresql_readonly": True}

    def test_selects_the_loader_contract_that_this_database_has(self, export):
        _, tables, conn = export
        assert tables["trajectory_points"] is None  # table absent from the old schema
        profile_columns = tables["profiles"]["columns"]
        contract = snapshot.LOADER_TABLES["profiles"][1]
        assert profile_columns == [c for c in contract if c in PROFILES.columns]
        # NULL arrays would reach the loader's literal_eval as NaN.
        datasets_sql = next(q for q in conn.queries if "FROM cde.datasets" in q)
        for column in snapshot.DATASET_ARRAY_COLUMNS & set(DATASETS.columns):
            assert f"coalesce({column}, '{{}}') AS {column}" in datasets_sql

    def test_the_loader_reads_back_what_the_database_held(self, export):
        folder, _, _ = export
        datasets = pd.read_csv(folder / "datasets.csv")
        assert ast.literal_eval(datasets.loc[0, "eovs"]) == ["seaSurfaceTemperature"]
        assert ast.literal_eval(datasets.loc[0, "table_variables"]) == DATASETS.loc[0, "table_variables"]
        assert datasets.loc[0, "content_hash"] == "abc"

        profiles = pd.read_csv(folder / "profiles.csv")
        assert parse_day_ranges(profiles.loc[0, "day_ranges"]) == [
            (D(2020, 1, 1), D(2020, 1, 4)), (D(2020, 1, 8), D(2020, 1, 11)),
        ]
        assert len(prepare_profiles_dataframe(profiles)) == 1

        runs = pd.read_csv(folder / "harvest_runs.csv")
        assert runs.loc[0, "run_id"] == "0b17f762-bad3-4aed-b65b-6688a4b07c4a"

    def test_writes_the_files_the_loader_always_opens_even_when_empty(self, export):
        folder, tables, _ = export
        assert (folder / "skipped.csv").is_file()
        assert tables["obis_cells"]["rows"] == 0
        assert not (folder / "obis_cells.csv").exists()

    def test_aux_tables_go_through_copy_on_the_same_connection(self, export):
        folder, tables, conn = export
        assert conn.copy_cursor.copies == ["COPY (SELECT * FROM cde.datasets_lookup) TO STDOUT WITH CSV HEADER"]
        assert (folder / "datasets_lookup.pg.csv").is_file()
        assert tables["scientific_name_vernaculars"] is None


class TestDropStaleHashes:
    @pytest.fixture
    def folder(self, tmp_path):
        pd.DataFrame({"dataset_id": ["ds1"], "content_hash": ["abc"]}).to_csv(tmp_path / "datasets.csv", index=False)
        return tmp_path

    def _manifest(self, profile_columns):
        tables = {t: {"columns": contract} for t, (_, contract) in snapshot.LOADER_TABLES.items()}
        tables["profiles"] = {"columns": profile_columns}
        return {"tables": tables}

    def test_missing_columns_clear_the_hashes(self, folder):
        full = snapshot.LOADER_TABLES["profiles"][1]
        missing = snapshot.drop_stale_hashes(folder, self._manifest([c for c in full if c != "eovs"]))
        assert missing == {"profiles": ["eovs"]}
        assert pd.read_csv(folder / "datasets.csv")["content_hash"].isna().all()

    def test_a_complete_snapshot_keeps_them(self, folder):
        assert snapshot.drop_stale_hashes(folder, self._manifest(snapshot.LOADER_TABLES["profiles"][1])) == {}
        assert pd.read_csv(folder / "datasets.csv").loc[0, "content_hash"] == "abc"

    def test_a_manifest_without_table_records_changes_nothing(self, folder):
        assert snapshot.drop_stale_hashes(folder, {}) == {}

    def test_a_table_the_old_schema_lacked_counts_as_missing(self, folder):
        manifest = self._manifest(snapshot.LOADER_TABLES["profiles"][1])
        manifest["tables"]["trajectory_days"] = None
        missing = snapshot.drop_stale_hashes(folder, manifest)
        assert missing == {"trajectory_days": sorted(snapshot.LOADER_TABLES["trajectory_days"][1])}
        assert pd.read_csv(folder / "datasets.csv")["content_hash"].isna().all()

    def test_an_audit_column_alone_keeps_the_hashes(self, folder):
        # A re-harvest never backfills old audit rows, so re-fetching buys nothing.
        manifest = self._manifest(snapshot.LOADER_TABLES["profiles"][1])
        manifest["tables"]["harvest_attempts"] = {"columns": ["run_id"]}
        assert snapshot.drop_stale_hashes(folder, manifest) == {}
        assert pd.read_csv(folder / "datasets.csv").loc[0, "content_hash"] == "abc"


class TestPublishing:
    def test_take_snapshot_publishes_a_full_reload_snapshot(self, monkeypatch):
        def export_snapshot(engine, out_dir):
            Path(out_dir, "datasets.csv").write_text("a\n1\n")
            return {"datasets": {"rows": 1, "columns": ["a"]}}

        monkeypatch.setattr(snapshot, "export_snapshot", export_snapshot)
        manifest = snapshot.take_snapshot(None, "memory://cde/test/snapshots/1")
        assert (manifest["kind"], manifest["incremental"]) == ("snapshot", False)
        assert manifest["tables"] == {"datasets": {"rows": 1, "columns": ["a"]}}

    def test_latest_published_is_the_newest_complete_non_empty_snapshot(self, tmp_path):
        (tmp_path / "datasets.csv").write_text("a\n1\n")
        for ts, rows in (("20260901_000000", 5), ("20260915_000000", 5), ("20260920_000000", 0)):
            publish.publish_folder(tmp_path, f"memory://cde/test/snapshots/{ts}", kind="snapshot",
                                   tables={"datasets": {"rows": rows, "columns": ["a"]}})
        # A newer upload that never finished (no manifest) must not be picked, nor
        # an empty database's snapshot.
        MemoryFileSystem().pipe_file("/cde/test/snapshots/20260922_000000/datasets.csv.gz", b"")
        assert snapshot.latest_published("memory://cde/test") == "memory://cde/test/snapshots/20260915_000000"

    def test_latest_published_with_no_snapshots(self):
        assert snapshot.latest_published("memory://cde/empty") is None


class TestRestoreAuxTables:
    TYPES = [
        ("datasets_lookup.pk", "integer"),
        ("datasets_lookup.dataset_id", "text"),
        ("datasets_lookup.erddap_url", "text"),
        ("organizations_lookup.pk", "integer"),
        ("organizations_lookup.name", "text"),
        ("scientific_name_vernaculars.scientific_name", "text"),
        ("scientific_name_vernaculars.ancestor_aphia_ids", "integer[]"),
    ]

    class Conn:
        def __init__(self, types):
            self.types = types
            self.sql = []
            self.connection = self

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def cursor(self):
            conn = self

            class Cursor:
                def __enter__(self):
                    return self

                def __exit__(self, *exc):
                    return False

                def copy_expert(self, sql, f):
                    conn.sql.append(sql)

            return Cursor()

        def execute(self, statement):
            self.sql.append(" ".join(str(statement).split()))

            class Result:
                def all(_):
                    return self.types

            return Result()

    def test_casts_each_column_skips_conflicts_and_resets_serials(self, tmp_path):
        (tmp_path / "datasets_lookup.pg.csv").write_text("pk,dataset_id,erddap_url,gone\n7,ds1,u,x\n")
        (tmp_path / "organizations_lookup.pg.csv").write_text("pk,name\n9,DFO\n")
        (tmp_path / "scientific_name_vernaculars.pg.csv").write_text(
            'scientific_name,ancestor_aphia_ids\nGadus,"{1,2}"\n'
        )
        conn = self.Conn(self.TYPES)
        engine = type("E", (), {"begin": lambda self: conn})()

        snapshot.restore_aux_tables(engine, tmp_path)

        inserts = [s for s in conn.sql if s.startswith("INSERT")]
        assert inserts[0] == (
            "INSERT INTO cde.datasets_lookup (pk, dataset_id, erddap_url) SELECT pk::integer, "
            "dataset_id::text, erddap_url::text FROM _restore ON CONFLICT DO NOTHING"
        )
        assert "ancestor_aphia_ids::integer[]" in inserts[2]
        # Both lookups have a serial pk; each sequence moves past the restored pks,
        # after that table's rows are in.
        for table in ("datasets_lookup", "organizations_lookup"):
            setval = (
                f"SELECT setval(pg_get_serial_sequence('cde.{table}', 'pk'), "
                f"coalesce(max(pk), 1), max(pk) IS NOT NULL) FROM cde.{table}"
            )
            insert = next(i for i, sql in enumerate(conn.sql) if sql.startswith(f"INSERT INTO cde.{table} "))
            assert conn.sql.index(setval) > insert
        assert len([sql for sql in conn.sql if "setval" in sql]) == 2



class TestLoaderLock:
    class Conn:
        def __init__(self, fail_unlock=False):
            self.sql, self.params, self.options = [], [], None
            self.fail_unlock = fail_unlock

        def execution_options(self, **kw):
            self.options = kw
            return self

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, statement, params):
            self.sql.append(str(statement))
            self.params.append(params)
            if self.fail_unlock and "unlock" in str(statement):
                raise RuntimeError("server closed the connection")

    def _engine(self, conn):
        return type("E", (), {"connect": lambda self: conn})()

    def test_holds_the_loader_key_as_a_session_lock(self):
        from cde_harvester.loading.loader import DB_LOADER_ADVISORY_LOCK_KEY

        conn = self.Conn()
        with snapshot.loader_lock(self._engine(conn)):
            # A transaction lock would be gone by now under AUTOCOMMIT.
            assert conn.sql == ["SELECT pg_advisory_lock(:k)"]
        assert conn.options == {"isolation_level": "AUTOCOMMIT"}
        assert conn.sql[-1] == "SELECT pg_advisory_unlock(:k)"
        assert conn.params == [{"k": DB_LOADER_ADVISORY_LOCK_KEY}] * 2

    def test_releases_when_the_body_raises(self):
        conn = self.Conn()
        with pytest.raises(RuntimeError, match="export failed"), snapshot.loader_lock(self._engine(conn)):
            raise RuntimeError("export failed")
        assert conn.sql[-1] == "SELECT pg_advisory_unlock(:k)"

    def test_a_dropped_connection_on_unlock_does_not_raise(self):
        with snapshot.loader_lock(self._engine(self.Conn(fail_unlock=True))):
            pass
