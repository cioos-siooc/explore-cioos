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

    def test_db_name_read_from_env_when_not_passed(self, monkeypatch):
        monkeypatch.setenv("DB_NAME", "cde_dev")
        assert schema.check_confirmation("cde_dev") == "cde_dev"
        with pytest.raises(ValueError):
            schema.check_confirmation("cde")
