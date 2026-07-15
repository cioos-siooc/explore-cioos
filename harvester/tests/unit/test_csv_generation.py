"""
Unit tests for CSV file generation and structural validation.

Each test generates its DataFrame by calling real codebase functions with
mocked ERDDAP responses — not by constructing fixtures by hand.

  datasets.csv  →  Dataset.get_df()      (cde_harvester.dataset)
  profiles.csv  →  get_profiles()        (cde_harvester.profiles)
  skipped.csv   →  CDEComplianceChecker  (cde_harvester.CDEComplianceChecker)
                   + harvester skipped-row assembly
"""

import ast
from io import StringIO

import pandas as pd
import pytest

from conftest import (
    DATASET_ID,
    DOMAIN,
    ERDDAP_INFO_CSV,
    ERDDAP_INFO_NO_EOVS_CSV,
    ERDDAP_URL,
    build_mock_dataset,
    mock_erddap_server,  # noqa: F401 — imported so pytest discovers the fixture
)

from cde_harvester.CDEComplianceChecker import CDEComplianceChecker
from cde_harvester.dataset import Dataset
from cde_harvester.profiles import get_profiles
from cde_harvester.schemas import SkippedDatasetSchema


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_dataset(server, info_csv=ERDDAP_INFO_CSV):
    """Construct a real Dataset backed by a mocked ERDDAP server."""
    server.erddap_csv_to_df.side_effect = lambda url, skiprows=None, dataset=None: (
        pd.read_csv(StringIO(info_csv)).fillna("")
    )
    return Dataset(server, DATASET_ID)


def _datasets_df(server):
    """Call the real Dataset.get_df() and return the resulting DataFrame."""
    ds = _make_dataset(server)
    ds.profile_ids = pd.DataFrame({
        "station_id": ["STATION_001"],
        "latitude": [48.5],
        "longitude": [-125.0],
    })
    return ds.get_df()


def _profiles_df():
    """Call the real get_profiles() with a mocked dataset."""
    return get_profiles(build_mock_dataset())


def _skipped_df():
    """
    Build the skipped DataFrame the same way ERDDAPHarvester.harvest() does:
    run CDEComplianceChecker on a dataset with no supported EOVs, capture the
    failure reason code, then assemble the row with the schema columns.
    """
    failing_dataset = build_mock_dataset(info_csv=ERDDAP_INFO_NO_EOVS_CSV)
    checker = CDEComplianceChecker(failing_dataset)
    assert not checker.passes_all_checks(), "expected dataset to fail compliance"

    skipped_columns = list(SkippedDatasetSchema.to_schema().columns.keys())
    reasons = [[DOMAIN, DATASET_ID, checker.failure_reason_code]]
    return pd.DataFrame(reasons, columns=skipped_columns)


def _roundtrip(df: pd.DataFrame, tmp_path, filename: str) -> pd.DataFrame:
    """Write a DataFrame to CSV and read it back, as the db-loader does."""
    path = tmp_path / filename
    df.to_csv(path, index=False)
    return pd.read_csv(path)


# ---------------------------------------------------------------------------
# datasets.csv
# ---------------------------------------------------------------------------

class TestDatasetsCsvGeneration:
    def test_get_df_returns_dataframe(self, mock_erddap_server):
        df = _datasets_df(mock_erddap_server)
        assert isinstance(df, pd.DataFrame)
        assert not df.empty

    def test_required_columns_present(self, mock_erddap_server):
        df = _datasets_df(mock_erddap_server)
        for col in [
            "title", "erddap_url", "dataset_id", "cdm_data_type",
            "platform", "eovs", "organizations", "n_profiles",
            "profile_variables", "timeseries_id_variable",
        ]:
            assert col in df.columns, f"Missing column: {col}"

    def test_dataset_id_matches(self, mock_erddap_server):
        df = _datasets_df(mock_erddap_server)
        assert df["dataset_id"].iloc[0] == DATASET_ID

    def test_erddap_url_matches(self, mock_erddap_server):
        df = _datasets_df(mock_erddap_server)
        assert df["erddap_url"].iloc[0] == ERDDAP_URL

    def test_eovs_is_a_non_empty_list(self, mock_erddap_server):
        df = _datasets_df(mock_erddap_server)
        eovs = df["eovs"].iloc[0]
        assert isinstance(eovs, list)
        assert len(eovs) > 0

    def test_eovs_survives_csv_roundtrip(self, mock_erddap_server, tmp_path):
        df = _datasets_df(mock_erddap_server)
        df_back = _roundtrip(df, tmp_path, "datasets.csv")
        eovs = ast.literal_eval(df_back["eovs"].iloc[0])
        assert isinstance(eovs, list)
        assert len(eovs) > 0

    def test_organizations_survives_csv_roundtrip(self, mock_erddap_server, tmp_path):
        df = _datasets_df(mock_erddap_server)
        df_back = _roundtrip(df, tmp_path, "datasets.csv")
        orgs = ast.literal_eval(df_back["organizations"].iloc[0])
        assert isinstance(orgs, list)

    def test_profile_variables_survives_csv_roundtrip(self, mock_erddap_server, tmp_path):
        df = _datasets_df(mock_erddap_server)
        df_back = _roundtrip(df, tmp_path, "datasets.csv")
        pv = ast.literal_eval(df_back["profile_variables"].iloc[0])
        assert isinstance(pv, list)

    def test_deduplication_removes_duplicate_rows(self, mock_erddap_server, tmp_path):
        df = _datasets_df(mock_erddap_server)
        duplicated = pd.concat([df, df], ignore_index=True)
        deduped = duplicated.drop_duplicates(["erddap_url", "dataset_id"])
        df_back = _roundtrip(deduped, tmp_path, "datasets.csv")
        assert df_back.duplicated(["erddap_url", "dataset_id"]).sum() == 0
        assert len(df_back) == 1


# ---------------------------------------------------------------------------
# profiles.csv
# ---------------------------------------------------------------------------

class TestProfilesCsvGeneration:
    def test_get_profiles_returns_dataframe(self):
        df = _profiles_df()
        assert isinstance(df, pd.DataFrame)
        assert not df.empty

    def test_required_columns_present(self):
        df = _profiles_df()
        for col in [
            "dataset_id", "erddap_url", "latitude", "longitude",
            "time_min", "time_max", "depth_min", "depth_max",
            "n_records", "records_per_day",
        ]:
            assert col in df.columns, f"Missing column: {col}"

    def test_dataset_id_matches(self):
        df = _profiles_df()
        assert (df["dataset_id"] == DATASET_ID).all()

    def test_erddap_url_matches(self):
        df = _profiles_df()
        assert (df["erddap_url"] == ERDDAP_URL).all()

    def test_latitude_within_bounds(self):
        df = _profiles_df()
        assert (df["latitude"] > -90).all()
        assert (df["latitude"] < 90).all()

    def test_longitude_within_bounds(self):
        df = _profiles_df()
        assert (df["longitude"] > -180).all()
        assert (df["longitude"] < 180).all()

    def test_depth_min_le_depth_max(self):
        df = _profiles_df()
        assert (df["depth_min"] <= df["depth_max"]).all()

    def test_time_min_before_time_max(self):
        df = _profiles_df()
        assert (df["time_min"] < df["time_max"]).all()

    def test_n_records_positive(self):
        df = _profiles_df()
        assert (df["n_records"] > 0).all()

    def test_roundtrip_preserves_row_count(self, tmp_path):
        df = _profiles_df()
        df_back = _roundtrip(df, tmp_path, "profiles.csv")
        assert len(df_back) == len(df)


# ---------------------------------------------------------------------------
# skipped.csv
# ---------------------------------------------------------------------------

class TestSkippedCsvGeneration:
    def test_compliance_checker_rejects_no_eov_dataset(self):
        failing_dataset = build_mock_dataset(info_csv=ERDDAP_INFO_NO_EOVS_CSV)
        checker = CDEComplianceChecker(failing_dataset)
        assert not checker.passes_all_checks()
        assert checker.failure_reason_code != ""

    def test_skipped_df_has_required_columns(self):
        df = _skipped_df()
        for col in ["erddap_url", "dataset_id", "reason_code"]:
            assert col in df.columns

    def test_reason_code_is_non_empty(self):
        df = _skipped_df()
        assert df["reason_code"].notna().all()
        assert (df["reason_code"] != "").all()

    def test_dataset_id_matches(self):
        df = _skipped_df()
        assert df["dataset_id"].iloc[0] == DATASET_ID

    def test_roundtrip_preserves_reason_code(self, tmp_path):
        df = _skipped_df()
        original_codes = df["reason_code"].tolist()
        df_back = _roundtrip(df, tmp_path, "skipped.csv")
        assert df_back["reason_code"].tolist() == original_codes
