"""
Unit tests for cde_harvester.loading.loader.

Tests cover:
1. Pure helper functions (prepare_profiles_dataframe, ensure_organization_pks)
2. Full-reload mode: correct SQL functions called, data written to right tables
3. Incremental mode: temp tables created and process_incremental_update called
"""

from unittest.mock import MagicMock

import pandas as pd
import pytest

from cde_harvester.loading.loader import (
    ensure_organization_pks,
    load_cells_copy,
    main,
    prepare_profiles_dataframe,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def harvest_folder(tmp_path, sample_datasets_df, sample_profiles_df, sample_skipped_df):
    """Write CSVs as the harvester would and return the folder path string."""
    sample_datasets_df.to_csv(tmp_path / "datasets.csv", index=False)
    sample_profiles_df.to_csv(tmp_path / "profiles.csv", index=False)
    sample_skipped_df.to_csv(tmp_path / "skipped.csv", index=False)
    return str(tmp_path)


@pytest.fixture
def mock_engine():
    """SQLAlchemy engine mock. __enter__.return_value sets the transaction object."""
    engine = MagicMock()
    conn = MagicMock()
    engine.begin.return_value.__enter__.return_value = conn
    engine.begin.return_value.__exit__.return_value = False
    return engine, conn


@pytest.fixture(autouse=True)
def db_env(monkeypatch):
    """Inject required env vars so main() can build the DB connection string."""
    monkeypatch.setenv("DB_USER", "testuser")
    monkeypatch.setenv("DB_PASSWORD", "testpass")
    monkeypatch.setenv("DB_HOST_EXTERNAL", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_NAME", "testdb")


def _run_main(harvest_folder, mock_engine, mocker, incremental=False):
    """
    Shared helper: patch create_db_engine and capture SQL strings passed to text().
    Returns the list of SQL strings that were executed.
    """
    engine, conn = mock_engine
    mocker.patch("cde_harvester.loading.loader.create_db_engine", return_value=engine)
    mocker.patch("cde_harvester.loading.loader.get_run_logger", return_value=__import__("logging").getLogger("test"))
    # Capture SQL strings; return the raw string so conn.execute gets it
    mock_text = mocker.patch(
        "cde_harvester.loading.loader.text", side_effect=lambda s: s
    )
    mocker.patch("pandas.DataFrame.to_sql")

    main.fn(harvest_folder, incremental=incremental)

    return [c.args[0] for c in mock_text.call_args_list]


# ---------------------------------------------------------------------------
# Pure function tests
# ---------------------------------------------------------------------------

class TestPrepareProfilesDataframe:
    def test_removes_altitude_columns(self, sample_profiles_df):
        df = sample_profiles_df.copy()
        df["altitude_min"] = 0.0
        df["altitude_max"] = 0.0
        result = prepare_profiles_dataframe(df)
        assert "altitude_min" not in result.columns
        assert "altitude_max" not in result.columns

    def test_drops_rows_where_time_min_is_null(self, sample_profiles_df):
        df = sample_profiles_df.copy()
        df.loc[0, "time_min"] = None
        result = prepare_profiles_dataframe(df)
        assert len(result) == 0

    def test_replaces_empty_strings_with_nan(self, sample_profiles_df):
        df = sample_profiles_df.copy()
        df["timeseries_id"] = ""
        result = prepare_profiles_dataframe(df)
        assert pd.isna(result["timeseries_id"].iloc[0])

    def test_valid_rows_preserved(self, sample_profiles_df):
        result = prepare_profiles_dataframe(sample_profiles_df.copy())
        assert len(result) == len(sample_profiles_df)


class TestLoadCellsCopy:
    def _copy_body(self, df):
        """Run load_cells_copy against a mocked cursor and return the CSV body
        handed to copy_expert."""
        transaction = MagicMock()
        cur = (
            transaction.connection.driver_connection.cursor
            .return_value.__enter__.return_value
        )
        captured = {}

        def grab(sql, buf):
            captured["body"] = buf.read()

        cur.copy_expert.side_effect = grab
        load_cells_copy(df, "temp_trajectory_cells", transaction)
        return captured["body"]

    def test_int64_renders_without_decimal_point_and_na_as_null(self):
        # regression: COPY does no casting, so "2.0" in a bigint column fails
        df = pd.DataFrame({"n_records": pd.array([2, None], dtype="Int64")})
        lines = self._copy_body(df).splitlines()
        assert lines[0] == "2"
        assert lines[1] == r"\N"

    def test_float_nan_renders_as_null(self):
        df = pd.DataFrame({"depth_min": [1.5, float("nan")]})
        lines = self._copy_body(df).splitlines()
        assert lines[0] == "1.5"
        assert lines[1] == r"\N"


class TestEnsureOrganizationPks:
    def test_missing_column_gets_empty_arrays(self, sample_datasets_df):
        df = sample_datasets_df.drop(
            columns=["organization_pks"],
            errors="ignore",
        )
        result = ensure_organization_pks(df)
        assert "organization_pks" in result.columns
        assert all(isinstance(v, list) for v in result["organization_pks"])

    def test_null_values_replaced_with_empty_lists(self, sample_datasets_df):
        df = sample_datasets_df.copy()
        df["organization_pks"] = None
        result = ensure_organization_pks(df)
        assert all(isinstance(v, list) for v in result["organization_pks"])


# ---------------------------------------------------------------------------
# main() — full reload mode
# ---------------------------------------------------------------------------

class TestDbLoaderMainFullReload:
    def test_drop_constraints_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("drop_constraints" in s for s in sql_calls)

    def test_remove_all_data_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("remove_all_data" in s for s in sql_calls)

    def test_profile_process_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("profile_process" in s for s in sql_calls)

    def test_set_constraints_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("set_constraints" in s for s in sql_calls)


# ---------------------------------------------------------------------------
# main() — incremental mode
# ---------------------------------------------------------------------------

class TestDbLoaderMainIncremental:
    def test_create_temp_tables_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=True)
        assert any("create_temp_tables" in s for s in sql_calls)

    def test_process_incremental_update_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=True)
        assert any("process_incremental_update" in s for s in sql_calls)

    def test_drop_constraints_not_called_in_incremental(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=True)
        assert not any("drop_constraints" in s for s in sql_calls)
        assert not any("remove_all_data" in s for s in sql_calls)
