"""
Integration test: full harvester pipeline with mocked external I/O.

Steps covered (mirrors the real nightly run):
  1. ERDDAP HTTP calls  → mocked via requests.Session.get
  2. CKAN HTTP calls    → mocked via requests.get
  3. ERDDAPHarvester    → runs with real Dataset/ComplianceChecker/profiles logic
  4. CSV output         → written to tmp_path via the real __main__.main()
  5. DB load            → SQLAlchemy engine mocked; correct SQL calls asserted

The test does NOT contact any live services.  It exercises the complete
data-flow transformation described in docs/data_flow.md.
"""

import ast
import logging
import os
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from conftest import (
    CKAN_EMPTY_RESPONSE,
    CKAN_PACKAGE_SEARCH_RESPONSE,
    DATASET_ID,
    ERDDAP_URL,
    MockResponse,
    _route_erddap_url,
)


# ---------------------------------------------------------------------------
# Session-level mock for all ERDDAP HTTP calls
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Step 1 + 2 + 3: Harvest phase (ERDDAP → HarvestResult)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def harvest_result(tmp_path_factory):
    """
    Run ERDDAPHarvester.harvest() against a fully-mocked ERDDAP server.
    Returns (profiles_df, datasets_df, variables_df, skipped_df).
    Uses harvest_erddap.fn() to bypass the Prefect @task decorator.
    """
    with (
        patch("cde_harvester.ERDDAP.requests.Session") as mock_session_cls,
        patch(
            "cde_harvester.ckan.create_ckan_erddap_link.requests.get",
            side_effect=_ckan_side_effects(),
        ),
    ):
        mock_session = MagicMock()
        mock_session.get.side_effect = _erddap_session_get
        mock_session_cls.return_value = mock_session

        from cde_harvester.erddap_harvester import harvest_erddap

        result = harvest_erddap.fn(ERDDAP_URL, limit_dataset_ids=[DATASET_ID])

    assert not result.datasets.empty, "harvest produced no datasets"
    return result.profiles, result.datasets, result.variables, result.skipped


# ---------------------------------------------------------------------------
# Step 3 tests: harvest output content
# ---------------------------------------------------------------------------

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
        """
        allDatasets CSV includes 'test_unsupported_001' (Point type).
        It should NOT appear in datasets (filtered before get_dataset is called).
        """
        _, datasets, _, skipped = harvest_result
        assert "test_unsupported_001" not in datasets["dataset_id"].values

    def test_variables_dataframe_populated(self, harvest_result):
        _, _, variables, _ = harvest_result
        assert not variables.empty
        assert "standard_name" in variables.columns


# ---------------------------------------------------------------------------
# Step 4: CSV writing phase
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def written_csv_folder(tmp_path_factory, harvest_result):
    """
    Run harvester __main__.main() (CKAN merge + CSV write) using the
    harvest DataFrames from harvest_result.

    Patches:
      - harvest_erddap.submit → returns a synchronous mock future holding
        the pre-collected HarvestResult so main() doesn't re-harvest
      - get_run_logger → stdlib logger (no Prefect context needed)
      - CKAN requests → fixture data
    """
    profiles, datasets, variables, skipped = harvest_result
    tmp = tmp_path_factory.mktemp("csv_phase")
    folder = str(tmp)

    from cde_harvester.base_harvester import HarvestResult
    hr = HarvestResult(profiles=profiles, datasets=datasets,
                       variables=variables, skipped=skipped)

    mock_future = MagicMock()
    mock_future.result.return_value = hr

    with (
        patch("cde_harvester.ERDDAP.requests.Session") as mock_session_cls,
        patch(
            "cde_harvester.ckan.create_ckan_erddap_link.requests.get",
            side_effect=_ckan_side_effects(),
        ),
        patch(
            "cde_harvester.__main__.get_run_logger",
            return_value=logging.getLogger("test"),
        ),
        patch(
            "cde_harvester.__main__.harvest_erddap"
        ) as mock_harvest_task,
    ):
        mock_session = MagicMock()
        mock_session.get.side_effect = _erddap_session_get
        mock_session_cls.return_value = mock_session
        mock_harvest_task.submit.return_value = mock_future

        from cde_harvester.__main__ import main as harvester_main

        harvester_main.fn(
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


# ---------------------------------------------------------------------------
# Step 5: DB load phase
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def db_load_calls(written_csv_folder):
    """
    Run db-loader main() against the written CSVs with a mocked SQLAlchemy
    engine. Returns the list of SQL strings passed to text().
    Uses main.fn() to bypass the Prefect @flow decorator.
    """
    engine = MagicMock()
    conn = MagicMock()
    engine.begin.return_value.__enter__.return_value = conn
    engine.begin.return_value.__exit__.return_value = False

    sql_calls = []

    with (
        patch("cde_db_loader.__main__.create_engine", return_value=engine),
        patch("cde_db_loader.__main__.load_dotenv"),
        patch(
            "cde_db_loader.__main__.get_run_logger",
            return_value=logging.getLogger("test"),
        ),
        patch(
            "cde_db_loader.__main__.text",
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
        from cde_db_loader.__main__ import main as db_main

        db_main.fn(written_csv_folder, incremental=False)

    return sql_calls


class TestDbLoadPhase:
    def test_drop_constraints_called(self, db_load_calls):
        assert any("drop_constraints" in c for c in db_load_calls)

    def test_remove_all_data_called(self, db_load_calls):
        assert any("remove_all_data" in c for c in db_load_calls)

    def test_profile_process_called(self, db_load_calls):
        assert any("profile_process" in c for c in db_load_calls)

    def test_create_hexes_called(self, db_load_calls):
        assert any("create_hexes" in c for c in db_load_calls)

    def test_set_constraints_called(self, db_load_calls):
        assert any("set_constraints" in c for c in db_load_calls)
