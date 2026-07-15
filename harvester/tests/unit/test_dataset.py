"""
Unit tests for cde_harvester.dataset.Dataset.

Dataset.__init__ calls get_metadata() immediately, which calls
erddap_server.erddap_csv_to_df. The mock_erddap_server fixture wires
that method to return the standard info fixture so no HTTP calls occur.
"""

import pandas as pd
import pytest

from conftest import (
    DATASET_ID,
    ERDDAP_INFO_CSV,
    ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV,
    ERDDAP_INFO_INGEST_FALSE_CSV,
    ERDDAP_INFO_NO_EOVS_CSV,
    ERDDAP_URL,
    build_variables_df,
    mock_erddap_server,  # noqa: F401 — imported for pytest fixture discovery
)


def _make_dataset(server, info_csv=ERDDAP_INFO_CSV):
    """Create a real Dataset object backed by a mock server."""
    from io import StringIO

    server.erddap_csv_to_df.side_effect = lambda url, skiprows=None, dataset=None: (
        pd.read_csv(StringIO(info_csv)).fillna("")
    )
    from cde_harvester.dataset import Dataset
    return Dataset(server, DATASET_ID)


class TestDatasetMetadataParsing:
    def test_id_stored(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.id == DATASET_ID

    def test_erddap_url_stored(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.erddap_url == ERDDAP_URL

    def test_cdm_data_type_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.cdm_data_type == "TimeSeries"

    def test_globals_dict_populated(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.globals["title"] == "Test Temperature Dataset"
        assert ds.globals["institution"] == "Test Institution"

    def test_variables_list_contains_expected_vars(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        for var in ["time", "latitude", "longitude", "depth", "temperature", "station_id"]:
            assert var in ds.variables_list

    def test_df_variables_index_is_variable_names(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert "temperature" in ds.df_variables.index
        assert "station_id" in ds.df_variables.index

    def test_standard_name_attribute_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.df_variables.loc["temperature"]["standard_name"] == "sea_water_temperature"

    def test_cf_role_attribute_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.df_variables.loc["station_id"]["cf_role"] == "timeseries_id"

    def test_organization_extracted_from_institution(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert "Test Institution" in ds.organizations

    def test_platform_defaults_to_unknown_when_no_platform_global(self, mock_erddap_server):
        # Our test info CSV has no 'platform' or 'platform_vocabulary' globals
        ds = _make_dataset(mock_erddap_server)
        assert ds.platform == "unknown"


class TestDatasetEOVMapping:
    def test_eovs_populated_when_supported_var_present(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        # sea_water_temperature maps to at least one CDE EOV
        assert len(ds.eovs) > 0

    def test_eovs_empty_when_no_supported_standard_names(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server, info_csv=ERDDAP_INFO_NO_EOVS_CSV)
        assert ds.eovs == []

    def test_first_eov_column_set(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.first_eov_column == "temperature"


class TestDatasetGetDf:
    def test_get_df_returns_dataframe(self, mock_erddap_server):
        from cde_harvester.profiles import get_profiles

        ds = _make_dataset(mock_erddap_server)
        # get_df requires profile_ids to be set; set a minimal value
        ds.profile_ids = pd.DataFrame({"station_id": ["S1"], "latitude": [48.5], "longitude": [-125.0]})
        df = ds.get_df()
        assert isinstance(df, pd.DataFrame)

    def test_get_df_contains_required_columns(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        ds.profile_ids = pd.DataFrame({"station_id": ["S1"], "latitude": [48.5], "longitude": [-125.0]})
        df = ds.get_df()
        required = ["title", "erddap_url", "dataset_id", "cdm_data_type", "platform", "eovs"]
        for col in required:
            assert col in df.columns
