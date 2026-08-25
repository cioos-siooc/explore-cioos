"""Unit tests for cde_harvester.core.schema (file discovery + apply order).

The SQL is exercised against a real Postgres separately — these cover the parts that
can go wrong without a database: which files get picked up, in what order, and that a
missing init file aborts rather than dropping a schema it cannot recreate.
"""

import pytest

from cde_harvester.core import schema


def _write(directory, name, body="SELECT 1;\n"):
    path = directory / name
    path.write_text(body)
    return path


class TestSchemaFiles:
    def test_init_file_is_returned_first(self, tmp_path):
        _write(tmp_path, "1_schema.sql")
        init, functions = schema.schema_files(tmp_path)
        assert init.name == "1_schema.sql"
        assert functions == []

    def test_function_files_sorted_numerically_not_lexically(self, tmp_path):
        _write(tmp_path, "1_schema.sql")
        for name in ("9_incremental_upsert.sql", "3_ckan_process.sql", "5_profile_process.sql"):
            _write(tmp_path, name)
        _, functions = schema.schema_files(tmp_path)
        assert [p.name for p in functions] == [
            "3_ckan_process.sql",
            "5_profile_process.sql",
            "9_incremental_upsert.sql",
        ]

    def test_init_file_excluded_from_function_files(self, tmp_path):
        """1_ and 2_ are init-only; db_migrate applies [3-9] and so do we."""
        _write(tmp_path, "1_schema.sql")
        _write(tmp_path, "2_seed.sql")
        _write(tmp_path, "4_create_hexes.sql")
        _, functions = schema.schema_files(tmp_path)
        assert [p.name for p in functions] == ["4_create_hexes.sql"]

    def test_missing_init_file_raises(self, tmp_path):
        """Better to fail loudly than DROP SCHEMA with no way to recreate it."""
        _write(tmp_path, "4_create_hexes.sql")
        with pytest.raises(FileNotFoundError, match="1_schema.sql"):
            schema.schema_files(tmp_path)

    def test_non_sql_files_ignored(self, tmp_path):
        _write(tmp_path, "1_schema.sql")
        _write(tmp_path, "4_create_hexes.sql")
        _write(tmp_path, "README.md", "# not sql")
        _, functions = schema.schema_files(tmp_path)
        assert [p.name for p in functions] == ["4_create_hexes.sql"]


class TestDatabaseDir:
    def test_explicit_argument_wins(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CDE_DATABASE_DIR", "/env/dir")
        assert schema.database_dir(tmp_path) == tmp_path

    def test_env_var_used_when_no_explicit_dir(self, monkeypatch):
        monkeypatch.setenv("CDE_DATABASE_DIR", "/env/dir")
        assert str(schema.database_dir()) == "/env/dir"

    def test_falls_back_to_repo_checkout(self, monkeypatch):
        """With no env var and no baked /app/database, resolve the repo's database/."""
        monkeypatch.delenv("CDE_DATABASE_DIR", raising=False)
        monkeypatch.setattr(schema.Path, "is_dir", lambda self: False)
        assert schema.database_dir().name == "database"


class TestRepoSqlFilesAreDiscoverable:
    """The real database/ directory must satisfy the loader — guards against a rename
    or a new numbered file silently dropping out of the rebuild."""

    def test_repo_database_dir_resolves(self, monkeypatch):
        monkeypatch.delenv("CDE_DATABASE_DIR", raising=False)
        init, functions = schema.schema_files(
            schema.Path(__file__).resolve().parents[3] / "database"
        )
        assert init.is_file()
        names = [p.name for p in functions]
        # The function files db_migrate re-applies; all must survive a rebuild.
        assert "4_create_hexes.sql" in names
        assert "5_profile_process.sql" in names
        assert "9_incremental_upsert.sql" in names

    def test_init_file_creates_the_trajectory_tables(self, monkeypatch):
        """1_schema.sql is the ONLY place these are created; if that stops being true
        the rebuild flow's premise is wrong."""
        monkeypatch.delenv("CDE_DATABASE_DIR", raising=False)
        init, _ = schema.schema_files(
            schema.Path(__file__).resolve().parents[3] / "database"
        )
        body = init.read_text()
        assert "CREATE TABLE trajectory_hexes" in body
        assert "CREATE TABLE trajectory_days" in body


class TestConfirmationGate:
    """The rebuild is a Run button in the Prefect UI; the gate is what stops a stray
    click from destroying a harvest."""

    def test_matching_name_passes(self):
        assert schema.check_confirmation("cde", db_name="cde") == "cde"

    def test_wrong_name_refuses(self):
        with pytest.raises(ValueError, match="DESTROYS ALL DATA"):
            schema.check_confirmation("yes", db_name="cde")

    def test_empty_confirm_refuses(self):
        """The parameter default must not be a valid confirmation."""
        with pytest.raises(ValueError, match="DESTROYS ALL DATA"):
            schema.check_confirmation("", db_name="cde")

    def test_error_names_the_database_and_host(self):
        with pytest.raises(ValueError, match="'cde_prod'.*on db.example.org"):
            schema.check_confirmation("", db_name="cde_prod", host="db.example.org")

    def test_unset_db_name_refuses_even_when_confirm_matches(self, monkeypatch):
        """confirm='' against an unset DB_NAME must not read as a match."""
        monkeypatch.delenv("DB_NAME", raising=False)
        with pytest.raises(ValueError, match="DB_NAME is not set"):
            schema.check_confirmation("")

    def test_empty_db_name_argument_refuses(self):
        """core_db.db_name() returns "" (not None) when unset, so the explicit-argument
        path has to reject it too — otherwise passing it through would skip the guard."""
        with pytest.raises(ValueError, match="DB_NAME is not set"):
            schema.check_confirmation("", db_name="")

    def test_unset_db_name_message_is_diagnostic(self, monkeypatch):
        monkeypatch.delenv("DB_NAME", raising=False)
        with pytest.raises(ValueError, match="printenv"):
            schema.check_confirmation("cde")

    def test_db_name_read_from_env_when_not_passed(self, monkeypatch):
        monkeypatch.setenv("DB_NAME", "cde_dev")
        assert schema.check_confirmation("cde_dev") == "cde_dev"
        with pytest.raises(ValueError):
            schema.check_confirmation("cde")


class TestDbNameResolution:
    """The guard must resolve DB_NAME the way the connection does. Reading os.environ
    directly made the flow fail with "DB_NAME is not set" on a worker whose engine
    resolves it via load_dotenv from the run's working directory."""

    def test_db_name_reads_dotenv_from_cwd(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        monkeypatch.delenv("DB_NAME", raising=False)
        (tmp_path / ".env").write_text("DB_NAME=cde_from_dotenv\n")
        monkeypatch.chdir(tmp_path)
        assert core_db.db_name() == "cde_from_dotenv"

    def test_db_name_empty_when_nothing_sets_it(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        monkeypatch.delenv("DB_NAME", raising=False)
        monkeypatch.chdir(tmp_path)
        assert core_db.db_name() == ""

    def test_db_host_also_reads_dotenv(self, tmp_path, monkeypatch):
        """Same asymmetry: db_host() is used in the guard's error message, so it has to
        report the host the engine would actually use."""
        from cde_harvester.core import db as core_db

        monkeypatch.delenv("DB_HOST_EXTERNAL", raising=False)
        (tmp_path / ".env").write_text("DB_HOST_EXTERNAL=db.internal\n")
        monkeypatch.chdir(tmp_path)
        assert core_db.db_host() == "db.internal"


class TestDotenvSearchesAncestors:
    """The .env is as likely to sit at the app root as in the harvester dir, and the flow
    run's cwd is the harvester dir. Only checking $CWD/.env is what let DB_NAME look unset
    to the guard while harvests connected fine."""

    def test_db_name_found_in_parent_directory(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        monkeypatch.delenv("DB_NAME", raising=False)
        (tmp_path / ".env").write_text("DB_NAME=cde_from_parent\n")
        child = tmp_path / "harvester"
        child.mkdir()
        monkeypatch.chdir(child)
        assert core_db.db_name() == "cde_from_parent"

    def test_nearest_dotenv_wins(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        monkeypatch.delenv("DB_NAME", raising=False)
        (tmp_path / ".env").write_text("DB_NAME=from_parent\n")
        child = tmp_path / "harvester"
        child.mkdir()
        (child / ".env").write_text("DB_NAME=from_child\n")
        monkeypatch.chdir(child)
        assert core_db.db_name() == "from_child"

    def test_real_environment_is_not_overridden(self, tmp_path, monkeypatch):
        """load_dotenv must not clobber what the container already set."""
        from cde_harvester.core import db as core_db

        monkeypatch.setenv("DB_NAME", "from_container_env")
        (tmp_path / ".env").write_text("DB_NAME=from_dotenv\n")
        monkeypatch.chdir(tmp_path)
        assert core_db.db_name() == "from_container_env"

    def test_guard_and_connection_agree_on_the_same_dotenv(self, tmp_path, monkeypatch):
        """The invariant that matters: whatever database_url() would connect to is what
        the guard demands confirmation for."""
        from cde_harvester.core import db as core_db

        for v in ("DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST_EXTERNAL"):
            monkeypatch.delenv(v, raising=False)
        (tmp_path / ".env").write_text(
            "DB_NAME=cde_agree\nDB_USER=u\nDB_PASSWORD=p\nDB_HOST_EXTERNAL=h\n"
        )
        monkeypatch.chdir(tmp_path)
        assert core_db.db_name() == "cde_agree"
        assert core_db.database_url().endswith("/cde_agree")
        assert schema.check_confirmation("cde_agree", db_name=core_db.db_name()) == "cde_agree"

    def test_missing_db_name_error_names_what_it_searched(self, tmp_path, monkeypatch):
        monkeypatch.delenv("DB_NAME", raising=False)
        monkeypatch.chdir(tmp_path)
        with pytest.raises(ValueError, match="cwd="):
            schema.check_confirmation("cde", db_name=None)


class TestRequiredDbSettings:
    """A fresh Coolify deployment supplies none of the DB_* settings (see
    .env.coolify.sample). Without them the worker used to start, register deployments,
    and then fail inside every flow run — so they are reported up front instead."""

    def test_missing_settings_are_all_reported(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        for v in core_db.REQUIRED_DB_SETTINGS:
            monkeypatch.delenv(v, raising=False)
        monkeypatch.chdir(tmp_path)
        assert set(core_db.missing_db_settings()) == set(core_db.REQUIRED_DB_SETTINGS)

    def test_nothing_missing_when_complete(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        monkeypatch.setenv("DB_NAME", "cde")
        monkeypatch.setenv("DB_USER", "postgres")
        monkeypatch.setenv("DB_PASSWORD", "p")
        monkeypatch.chdir(tmp_path)
        assert core_db.missing_db_settings() == []

    def test_partial_config_reports_only_the_gaps(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        monkeypatch.setenv("DB_NAME", "cde")
        monkeypatch.delenv("DB_USER", raising=False)
        monkeypatch.delenv("DB_PASSWORD", raising=False)
        monkeypatch.chdir(tmp_path)
        assert core_db.missing_db_settings() == ["DB_USER", "DB_PASSWORD"]

    def test_empty_string_counts_as_missing(self, tmp_path, monkeypatch):
        """Coolify writes empty values for variables left blank in the UI."""
        from cde_harvester.core import db as core_db

        monkeypatch.setenv("DB_NAME", "")
        monkeypatch.setenv("DB_USER", "postgres")
        monkeypatch.setenv("DB_PASSWORD", "p")
        monkeypatch.chdir(tmp_path)
        assert core_db.missing_db_settings() == ["DB_NAME"]

    def test_database_url_names_every_missing_setting(self, tmp_path, monkeypatch):
        """Was a bare KeyError naming only the first gap, with no hint it was config."""
        from cde_harvester.core import db as core_db

        for v in core_db.REQUIRED_DB_SETTINGS:
            monkeypatch.delenv(v, raising=False)
        monkeypatch.chdir(tmp_path)
        with pytest.raises(ValueError, match="DB_NAME, DB_USER, DB_PASSWORD"):
            core_db.database_url()

    def test_database_url_still_builds_when_complete(self, tmp_path, monkeypatch):
        from cde_harvester.core import db as core_db

        monkeypatch.setenv("DB_NAME", "cde")
        monkeypatch.setenv("DB_USER", "postgres")
        monkeypatch.setenv("DB_PASSWORD", "p")
        monkeypatch.setenv("DB_HOST_EXTERNAL", "db")
        monkeypatch.chdir(tmp_path)
        assert core_db.database_url() == "postgresql://postgres:p@db:5432/cde"


class TestRebuildFlowBody:
    """The flow body, called via .fn (no Prefect API needed).

    The ordering property under test: everything after rebuild_schema() runs AFTER an
    irreversible DROP SCHEMA, so none of it may turn a completed rebuild into a failed
    flow run — a red run invites re-running a destructive operation that already worked.
    """

    @staticmethod
    def _flow():
        from cde_harvester.prefect_pipeline import cde_rebuild_database_run

        return cde_rebuild_database_run.fn

    @staticmethod
    def _patch(monkeypatch, *, rebuild=None, trigger=None, flush=None):
        from cde_harvester import prefect_pipeline as pp

        default_report = {
            "schema": "cde",
            "init_file": "1_schema.sql",
            "function_files": ["4_create_hexes.sql"],
            "tables_created": 18,
        }
        monkeypatch.setattr(
            pp, "rebuild_schema", rebuild or (lambda engine: dict(default_report))
        )
        monkeypatch.setattr(pp, "run_deployment", trigger or (lambda **kw: None))
        monkeypatch.setattr(pp, "clearRedisCache", flush or (lambda: None))
        monkeypatch.setattr(pp.core_db, "create_db_engine", lambda **kw: _FakeEngine())
        monkeypatch.setattr(pp.core_db, "db_name", lambda: "cde")
        monkeypatch.setattr(pp.core_db, "db_host", lambda: "db")

    def test_happy_path_reports_trigger(self, monkeypatch):
        self._patch(monkeypatch)
        report = self._flow()(confirm="cde")
        assert report["tables_created"] == 18
        assert report["harvest_triggered"] is True

    def test_harvest_trigger_failure_does_not_fail_the_flow(self, monkeypatch):
        def boom(**kw):
            raise RuntimeError("deployment not found")

        self._patch(monkeypatch, trigger=boom)
        report = self._flow()(confirm="cde")
        assert report["harvest_triggered"] is False
        assert "deployment not found" in report["harvest_trigger_error"]

    def test_redis_flush_failure_does_not_fail_the_flow(self, monkeypatch):
        def boom():
            raise RuntimeError("no redis here")

        self._patch(monkeypatch, flush=boom)
        report = self._flow()(confirm="cde")
        assert report["harvest_triggered"] is True

    def test_wrong_confirm_aborts_before_touching_the_schema(self, monkeypatch):
        called = []
        self._patch(monkeypatch, rebuild=lambda engine: called.append(1) or {})
        with pytest.raises(ValueError, match="DESTROYS ALL DATA"):
            self._flow()(confirm="nope")
        assert called == [], "rebuild_schema must not run when confirmation fails"

    def test_run_harvest_false_skips_the_trigger(self, monkeypatch):
        called = []
        self._patch(monkeypatch, trigger=lambda **kw: called.append(1))
        report = self._flow()(confirm="cde", run_harvest=False)
        assert called == []
        assert "harvest_triggered" not in report

    def test_rebuild_failure_does_propagate(self, monkeypatch):
        """A failure of the rebuild itself must fail the run — nothing was committed."""
        def boom(engine):
            raise RuntimeError("lock timeout")

        self._patch(monkeypatch, rebuild=boom)
        with pytest.raises(RuntimeError, match="lock timeout"):
            self._flow()(confirm="cde")


class _FakeEngine:
    def dispose(self):
        pass
