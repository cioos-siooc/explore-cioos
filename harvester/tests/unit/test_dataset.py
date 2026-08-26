"""
Unit tests for cde_harvester.sources.erddap.dataset.Dataset.

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
    ERDDAP_INFO_QC_AND_LOG_CSV,
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
    from cde_harvester.sources.erddap.dataset import Dataset
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


class TestPlottingAttributes:
    """The attributes the faceted dataset preview needs.

    All of these ride in on the same /info/ document get_metadata() already
    downloads; they reach df_variables only because they are listed in
    CONSIDERED_VARIABLE_ATTRIBUTES.
    """

    def test_allowlist_covers_the_plotting_attributes(self):
        from cde_harvester.sources.erddap.dataset import (
            CONSIDERED_VARIABLE_ATTRIBUTES,
        )

        for attr in [
            "colorBarPalette",
            "colorBarMinimum",
            "colorBarMaximum",
            "colorBarScale",
            "colorBarContinuous",
            "ioos_category",
            "flag_values",
            "flag_meanings",
            "ancillary_variables",
        ]:
            assert attr in CONSIDERED_VARIABLE_ATTRIBUTES

    def test_colorbar_palette_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.df_variables.loc["temperature"]["colorBarPalette"] == "KT_thermal"
        assert ds.df_variables.loc["depth"]["colorBarPalette"] == "TopographyDepth"

    def test_colorbar_range_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        temperature = ds.df_variables.loc["temperature"]
        assert float(temperature["colorBarMinimum"]) == -10.0
        assert float(temperature["colorBarMaximum"]) == 40.0

    def test_colorbar_absent_reads_as_empty_not_missing(self, mock_erddap_server):
        # get_metadata() fillna("")s the pivot, so a variable that declares no
        # palette must be falsy rather than NaN — consumers test truthiness.
        ds = _make_dataset(mock_erddap_server)
        assert ds.df_variables.loc["latitude"]["colorBarPalette"] == ""

    def test_ioos_category_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        assert ds.df_variables.loc["temperature"]["ioos_category"] == "Temperature"
        assert ds.df_variables.loc["time"]["ioos_category"] == "Time"

    def test_axis_attribute_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        axes = {
            name: ds.df_variables.loc[name]["axis"]
            for name in ["time", "latitude", "longitude", "depth"]
        }
        assert axes == {"time": "T", "latitude": "Y", "longitude": "X", "depth": "Z"}

    def test_long_name_and_units_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server)
        temperature = ds.df_variables.loc["temperature"]
        assert temperature["long_name"] == "Sea Water Temperature"
        assert temperature["units"] == "degree_C"

    def test_colorbar_scale_and_continuity_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server, info_csv=ERDDAP_INFO_QC_AND_LOG_CSV)
        chlorophyll = ds.df_variables.loc["chlorophyll"]
        assert chlorophyll["colorBarScale"] == "Log"
        assert chlorophyll["colorBarContinuous"] == "false"

    def test_qc_flag_attributes_parsed(self, mock_erddap_server):
        ds = _make_dataset(mock_erddap_server, info_csv=ERDDAP_INFO_QC_AND_LOG_CSV)
        flag = ds.df_variables.loc["chlorophyll_qc"]
        assert flag["flag_values"] == "1, 2, 3, 4, 9"
        assert "questionable" in flag["flag_meanings"]

    def test_ancillary_variables_links_data_var_to_its_flag(self, mock_erddap_server):
        # This is the signal that lets a plot drop a flag column even when the
        # column name follows no naming convention.
        ds = _make_dataset(mock_erddap_server, info_csv=ERDDAP_INFO_QC_AND_LOG_CSV)
        assert (
            ds.df_variables.loc["chlorophyll"]["ancillary_variables"]
            == "chlorophyll_qc"
        )

    def test_widening_the_allowlist_did_not_change_num_columns(self, mock_erddap_server):
        # num_columns counts df_variables ROWS (variables), not attributes, so
        # adding attributes to the allowlist must not move it.
        ds = _make_dataset(mock_erddap_server)
        assert len(ds.df_variables) == 6


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
        from cde_harvester.dataset_types import extract_features as get_profiles

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
