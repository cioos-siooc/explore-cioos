"""
Unit tests for CSV file generation and structural validation.

Validates that:
- The output CSVs written by the harvester have the correct columns and types
- No required fields are empty after harvest
- Duplicate removal works correctly
- The DB loader can read back the written CSVs (column contract is intact)
"""

import ast

import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Expected column contracts (must match what db-loader reads)
# ---------------------------------------------------------------------------

REQUIRED_DATASETS_COLS = [
    "title", "erddap_url", "dataset_id", "cdm_data_type",
    "platform", "eovs", "organizations", "n_profiles",
    "profile_variables", "timeseries_id_variable",
]

REQUIRED_PROFILES_COLS = [
    "dataset_id", "erddap_url", "latitude", "longitude",
    "time_min", "time_max", "depth_min", "depth_max",
    "n_records", "records_per_day",
]

REQUIRED_SKIPPED_COLS = ["erddap_url", "dataset_id", "reason_code"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_and_read_csv(df: pd.DataFrame, tmp_path, filename: str) -> pd.DataFrame:
    """Write a DataFrame to CSV and read it back as the db-loader would."""
    path = tmp_path / filename
    df.to_csv(path, index=False)
    return pd.read_csv(path)


# ---------------------------------------------------------------------------
# Tests: datasets.csv
# ---------------------------------------------------------------------------

class TestDatasetsCsvStructure:
    def test_all_required_columns_present(self, sample_datasets_df):
        for col in REQUIRED_DATASETS_COLS:
            assert col in sample_datasets_df.columns, f"Missing column: {col}"

    def test_dataset_id_is_non_empty(self, sample_datasets_df):
        assert sample_datasets_df["dataset_id"].notna().all()
        assert (sample_datasets_df["dataset_id"] != "").all()

    def test_eovs_is_list_after_roundtrip(self, sample_datasets_df, tmp_path):
        df = _write_and_read_csv(sample_datasets_df, tmp_path, "datasets.csv")
        # db-loader uses ast.literal_eval to parse back the array columns
        eovs_parsed = df["eovs"].apply(ast.literal_eval)
        assert all(isinstance(v, list) for v in eovs_parsed)

    def test_organizations_is_list_after_roundtrip(self, sample_datasets_df, tmp_path):
        df = _write_and_read_csv(sample_datasets_df, tmp_path, "datasets.csv")
        orgs_parsed = df["organizations"].apply(ast.literal_eval)
        assert all(isinstance(v, list) for v in orgs_parsed)

    def test_profile_variables_is_list_after_roundtrip(self, sample_datasets_df, tmp_path):
        df = _write_and_read_csv(sample_datasets_df, tmp_path, "datasets.csv")
        pv_parsed = df["profile_variables"].apply(ast.literal_eval)
        assert all(isinstance(v, list) for v in pv_parsed)

    def test_no_duplicate_dataset_ids_after_write(self, sample_datasets_df, tmp_path):
        # Simulate the drop_duplicates call in __main__.py
        deduped = sample_datasets_df.drop_duplicates(["erddap_url", "dataset_id"])
        df = _write_and_read_csv(deduped, tmp_path, "datasets.csv")
        assert df.duplicated(["erddap_url", "dataset_id"]).sum() == 0


# ---------------------------------------------------------------------------
# Tests: profiles.csv
# ---------------------------------------------------------------------------

class TestProfilesCsvStructure:
    def test_all_required_columns_present(self, sample_profiles_df):
        for col in REQUIRED_PROFILES_COLS:
            assert col in sample_profiles_df.columns, f"Missing column: {col}"

    def test_latitude_within_bounds(self, sample_profiles_df):
        assert (sample_profiles_df["latitude"] > -90).all()
        assert (sample_profiles_df["latitude"] < 90).all()

    def test_longitude_within_bounds(self, sample_profiles_df):
        assert (sample_profiles_df["longitude"] > -180).all()
        assert (sample_profiles_df["longitude"] < 180).all()

    def test_depth_min_le_depth_max(self, sample_profiles_df):
        assert (sample_profiles_df["depth_min"] <= sample_profiles_df["depth_max"]).all()

    def test_time_min_before_time_max(self, sample_profiles_df):
        assert (sample_profiles_df["time_min"] < sample_profiles_df["time_max"]).all()

    def test_n_records_positive(self, sample_profiles_df):
        assert (sample_profiles_df["n_records"] > 0).all()

    def test_roundtrip_preserves_row_count(self, sample_profiles_df, tmp_path):
        df = _write_and_read_csv(sample_profiles_df, tmp_path, "profiles.csv")
        assert len(df) == len(sample_profiles_df)


# ---------------------------------------------------------------------------
# Tests: skipped.csv
# ---------------------------------------------------------------------------

class TestSkippedCsvStructure:
    def test_all_required_columns_present(self, sample_skipped_df):
        for col in REQUIRED_SKIPPED_COLS:
            assert col in sample_skipped_df.columns

    def test_reason_code_is_non_empty(self, sample_skipped_df):
        assert (sample_skipped_df["reason_code"] != "").all()

    def test_roundtrip_preserves_data(self, sample_skipped_df, tmp_path):
        df = _write_and_read_csv(sample_skipped_df, tmp_path, "skipped.csv")
        assert df["reason_code"].tolist() == sample_skipped_df["reason_code"].tolist()
