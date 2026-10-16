"""Integration test: harvest -> CSV -> DB load, with every external I/O mocked."""

import ast
import logging
import os
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from cde_harvester.__main__ import (
    get_ckan_records,
    merge_and_write_csvs,
)
from cde_harvester.__main__ import (
    main as harvester_main,
)
from cde_harvester.loading.loader import main as db_main
from cde_harvester.sources.base import HarvestResult
from cde_harvester.sources.erddap.harvester import harvest_erddap
from conftest import (
    CKAN_EMPTY_RESPONSE,
    CKAN_PACKAGE_SEARCH_RESPONSE,
    DATASET_ID,
    ERDDAP_URL,
    MockResponse,
    _route_erddap_url,
)


def _erddap_session_get(url, **kwargs):
    """Route every ERDDAP request to the right fixture CSV."""
    text = _route_erddap_url(url)
    return MockResponse(text=text, url=url)


def _ckan_side_effects():
    page1 = MagicMock()
    page1.json.return_value = CKAN_PACKAGE_SEARCH_RESPONSE
    page2 = MagicMock()
    page2.json.return_value = CKAN_EMPTY_RESPONSE
    return [page1, page2]


@pytest.fixture(scope="module")
def harvest_result(tmp_path_factory):
    """Run harvest_erddap.fn() against a fully-mocked ERDDAP server."""
    with (
        patch("cde_harvester.sources.erddap.client.requests.Session") as mock_session_cls,
        patch(
            "cde_harvester.sources.ckan.create_ckan_erddap_link.requests.get",
            side_effect=_ckan_side_effects(),
        ),
    ):
        mock_session = MagicMock()
        mock_session.get.side_effect = _erddap_session_get
        mock_session_cls.return_value = mock_session

        result = harvest_erddap.fn(ERDDAP_URL, limit_dataset_ids=[DATASET_ID])

    assert not result.datasets.empty, "harvest produced no datasets"
    return result.profiles, result.datasets, result.variables, result.skipped


class TestHarvestOutput:
    def test_compliant_dataset_is_harvested(self, harvest_result):
        _, datasets, _, _ = harvest_result
        assert DATASET_ID in datasets["dataset_id"].values

    def test_at_least_one_profile_extracted(self, harvest_result):
        profiles, _, _, _ = harvest_result
        assert len(profiles) >= 1

    def test_profiles_have_required_columns(self, harvest_result):
        profiles, _, _, _ = harvest_result
        required = [
            "latitude", "longitude", "time_min", "time_max",
            "depth_min", "depth_max", "n_records", "dataset_id", "erddap_url",
        ]
        for col in required:
            assert col in profiles.columns, f"Profiles missing column: {col}"

    def test_dataset_has_eovs(self, harvest_result):
        _, datasets, _, _ = harvest_result
        row = datasets[datasets["dataset_id"] == DATASET_ID].iloc[0]
        assert len(row["eovs"]) > 0

    def test_unsupported_dataset_is_skipped(self, harvest_result):
        """test_unsupported_001 (Point) is filtered before get_dataset is called."""
        _, datasets, _, skipped = harvest_result
        assert "test_unsupported_001" not in datasets["dataset_id"].values

    def test_variables_dataframe_populated(self, harvest_result):
        _, _, variables, _ = harvest_result
        assert not variables.empty
        assert "standard_name" in variables.columns


def _submit_without_flow(task, *, as_future=False):
    """Stand-in for Task.submit(): .submit() needs a flow context's task runner,
    so run the wrapped .fn synchronously, dropping Prefect's wait_for kwarg."""
    def _submit(*args, wait_for=None, **kwargs):
        value = task.fn(*args, **kwargs)
        if not as_future:
            return value
        future = MagicMock()
        future.result.return_value = value
        return future

    return _submit


@pytest.fixture(scope="module")
def written_csv_folder(tmp_path_factory, harvest_result):
    """Run harvester __main__.main() (CKAN merge + CSV write) on the
    pre-collected HarvestResult, with tasks run synchronously."""
    profiles, datasets, variables, skipped = harvest_result
    tmp = tmp_path_factory.mktemp("csv_phase")
    folder = str(tmp)

    hr = HarvestResult(profiles=profiles, datasets=datasets,
                       variables=variables, skipped=skipped)

    mock_future = MagicMock()
    mock_future.result.return_value = hr

    with (
        patch("cde_harvester.sources.erddap.client.requests.Session") as mock_session_cls,
        patch(
            "cde_harvester.sources.ckan.create_ckan_erddap_link._build_ckan_session",
        ) as mock_ckan_session_builder,
        patch(
            "cde_harvester.__main__.get_run_logger",
            return_value=logging.getLogger("test"),
        ),
        patch(
            "cde_harvester.__main__.harvest_erddap"
        ) as mock_harvest_task,
        patch.object(
            get_ckan_records, "submit", _submit_without_flow(get_ckan_records)
        ),
        patch.object(
            merge_and_write_csvs,
            "submit",
            _submit_without_flow(merge_and_write_csvs, as_future=True),
        ),
    ):
        mock_session = MagicMock()
        mock_session.get.side_effect = _erddap_session_get
        mock_session_cls.return_value = mock_session

        ckan_session = MagicMock()
        ckan_session.get.side_effect = _ckan_side_effects()
        mock_ckan_session_builder.return_value = ckan_session

        mock_harvest_task.submit.return_value = mock_future

        harvester_main(
            erddap_urls=ERDDAP_URL,
            cache_requests=False,
            folder=folder,
            dataset_ids=DATASET_ID,
        )

    return folder


class TestCsvFilesWritten:
    def test_datasets_csv_exists(self, written_csv_folder):
        assert os.path.exists(os.path.join(written_csv_folder, "datasets.csv"))

    def test_profiles_csv_exists(self, written_csv_folder):
        assert os.path.exists(os.path.join(written_csv_folder, "profiles.csv"))

    def test_skipped_csv_exists(self, written_csv_folder):
        assert os.path.exists(os.path.join(written_csv_folder, "skipped.csv"))

    def test_datasets_csv_readable(self, written_csv_folder):
        df = pd.read_csv(os.path.join(written_csv_folder, "datasets.csv"))
        assert not df.empty

    def test_profiles_csv_readable(self, written_csv_folder):
        df = pd.read_csv(os.path.join(written_csv_folder, "profiles.csv"))
        assert not df.empty

    def test_datasets_csv_array_columns_parse_correctly(self, written_csv_folder):
        df = pd.read_csv(os.path.join(written_csv_folder, "datasets.csv"))
        for col in ["eovs", "organizations", "profile_variables"]:
            parsed = df[col].apply(ast.literal_eval)
            assert all(isinstance(v, list) for v in parsed)

    def test_ckan_title_merged_into_datasets(self, written_csv_folder):
        df = pd.read_csv(os.path.join(written_csv_folder, "datasets.csv"))
        row = df[df["dataset_id"] == DATASET_ID].iloc[0]
        assert "Test Dataset" in str(row["title"])

    def test_french_title_present(self, written_csv_folder):
        df = pd.read_csv(os.path.join(written_csv_folder, "datasets.csv"))
        row = df[df["dataset_id"] == DATASET_ID].iloc[0]
        assert pd.notna(row.get("title_fr"))


@pytest.fixture(scope="module")
def db_load_calls(written_csv_folder):
    """Run db-loader main.fn() on the written CSVs; return the SQL passed to text()."""
    engine = MagicMock()
    conn = MagicMock()
    engine.begin.return_value.__enter__.return_value = conn
    engine.begin.return_value.__exit__.return_value = False

    sql_calls = []

    with (
        patch("cde_harvester.loading.loader.create_db_engine", return_value=engine),
        patch(
            "cde_harvester.loading.loader.get_run_logger",
            return_value=logging.getLogger("test"),
        ),
        patch(
            "cde_harvester.loading.loader.text",
            side_effect=lambda s: sql_calls.append(s) or s,
        ),
        patch("pandas.DataFrame.to_sql"),
        patch.dict(
            os.environ,
            {
                "DB_USER": "u", "DB_PASSWORD": "p",
                "DB_HOST_EXTERNAL": "localhost",
                "DB_PORT": "5432", "DB_NAME": "testdb",
            },
        ),
    ):
        db_main.fn(written_csv_folder, incremental=False)

    return sql_calls


class TestDbLoadPhase:
    def test_no_constraint_ddl_toggling(self, db_load_calls):
        # Constraints are permanent (NULL-able columns + DEFERRABLE hex FKs).
        assert not any("drop_constraints" in c for c in db_load_calls)

    def test_remove_all_data_called(self, db_load_calls):
        assert any("remove_all_data" in c for c in db_load_calls)

    def test_profile_process_called(self, db_load_calls):
        assert any("profile_process" in c for c in db_load_calls)

    def test_create_hexes_called(self, db_load_calls):
        assert any("create_hexes" in c for c in db_load_calls)

    def test_validate_loaded_data_called(self, db_load_calls):
        assert any("validate_loaded_data" in c for c in db_load_calls)
