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


def _patch_loader(mock_engine, mocker):
    """Patch the loader's DB and logging seams. Returns the mocked `text`,
    whose call args are the SQL strings the run executed."""
    engine, _conn = mock_engine
    mocker.patch("cde_harvester.loading.loader.create_db_engine", return_value=engine)
    mocker.patch("cde_harvester.loading.loader.get_run_logger", return_value=__import__("logging").getLogger("test"))
    mocker.patch("pandas.DataFrame.to_sql")
    # Capture SQL strings; return the raw string so conn.execute gets it
    return mocker.patch("cde_harvester.loading.loader.text", side_effect=lambda s: s)


def _run_main(harvest_folder, mock_engine, mocker, incremental=False):
    """
    Shared helper: patch create_db_engine and capture SQL strings passed to text().
    Returns the list of SQL strings that were executed.
    """
    mock_text = _patch_loader(mock_engine, mocker)

    main.fn(harvest_folder, incremental=incremental)

    return [c.args[0] for c in mock_text.call_args_list]


def _run_main_summary(harvest_folder, mock_engine, mocker, incremental=False, scalar=0):
    """Run main() and return its summary dict. `scalar` is what every
    `.scalar()` call yields — notably prune_stale_datasets' removed-row count,
    which feeds the summary's `pruned` (a bare MagicMock would read as truthy
    and make every run look changed). It has to be set on both the begin() and
    connect() chains: the load runs on the former, the prune on the latter."""
    engine, conn = mock_engine
    conn.execute.return_value.scalar.return_value = scalar
    (
        engine.connect.return_value.__enter__.return_value
        .execute.return_value.scalar.return_value
    ) = scalar
    _patch_loader(mock_engine, mocker)

    return main.fn(harvest_folder, incremental=incremental)


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
        load_cells_copy(df, "temp_trajectory_days", transaction)
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
    def test_no_constraint_ddl_toggling(self, harvest_folder, mock_engine, mocker):
        # Full reload no longer drops/re-adds constraints via ALTER TABLE:
        # columns are permanently NULL-able and the hex FKs are DEFERRABLE.
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert not any("drop_constraints" in s for s in sql_calls)

    def test_remove_all_data_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("remove_all_data" in s for s in sql_calls)

    def test_profile_process_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("profile_process" in s for s in sql_calls)

    def test_validate_loaded_data_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("validate_loaded_data" in s for s in sql_calls)

    def test_refresh_dataset_day_ranges_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=False)
        assert any("refresh_dataset_day_ranges" in s for s in sql_calls)


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

    def test_refresh_dataset_day_ranges_called(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=True)
        assert any("refresh_dataset_day_ranges" in s for s in sql_calls)

    def test_drop_constraints_not_called_in_incremental(self, harvest_folder, mock_engine, mocker):
        sql_calls = _run_main(harvest_folder, mock_engine, mocker, incremental=True)
        assert not any("drop_constraints" in s for s in sql_calls)
        assert not any("remove_all_data" in s for s in sql_calls)


# ---------------------------------------------------------------------------
# main() — the summary it returns
# ---------------------------------------------------------------------------

@pytest.fixture
def unchanged_harvest_folder(tmp_path, sample_datasets_df, sample_profiles_df, sample_skipped_df):
    """A harvest run where every dataset hashed unchanged: the harvester writes
    the columns but no rows to datasets.csv (the changed ones), and the
    unchanged ones go to verified.csv instead."""
    sample_datasets_df.iloc[0:0].to_csv(tmp_path / "datasets.csv", index=False)
    sample_profiles_df.iloc[0:0].to_csv(tmp_path / "profiles.csv", index=False)
    sample_skipped_df.to_csv(tmp_path / "skipped.csv", index=False)
    return str(tmp_path)


class TestLoadSummary:
    """The pipeline drops the redis cache off this summary, so `changed` has to
    mean "something a cached API response is built from moved"."""

    def test_incremental_with_changed_datasets_is_changed(
        self, harvest_folder, mock_engine, mocker
    ):
        summary = _run_main_summary(harvest_folder, mock_engine, mocker, incremental=True)
        assert summary["changed"] is True
        assert summary["changed_datasets"] == 1
        assert summary["full_reload"] is False

    def test_incremental_with_nothing_changed_is_unchanged(
        self, unchanged_harvest_folder, mock_engine, mocker
    ):
        # The whole point: a no-op harvest must leave the cache warm.
        summary = _run_main_summary(
            unchanged_harvest_folder, mock_engine, mocker, incremental=True
        )
        assert summary["changed"] is False
        assert summary["changed_datasets"] == 0
        assert summary["pruned"] == 0

    def test_pruning_alone_counts_as_changed(
        self, unchanged_harvest_folder, mock_engine, mocker
    ):
        # No dataset changed, but some disappeared upstream and were removed —
        # cached responses still reference them.
        summary = _run_main_summary(
            unchanged_harvest_folder, mock_engine, mocker, incremental=True, scalar=3
        )
        assert summary["pruned"] == 3
        assert summary["changed"] is True

    def test_full_reload_is_always_changed(self, harvest_folder, mock_engine, mocker):
        # A full reload TRUNCATEs, so every cached response is stale by definition.
        summary = _run_main_summary(harvest_folder, mock_engine, mocker, incremental=False)
        assert summary["changed"] is True
        assert summary["full_reload"] is True
