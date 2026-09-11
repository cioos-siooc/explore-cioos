"""The variable list the download URL is built from.

This used to come from constructing the harvester's ``Dataset`` object, which
fetches the same ``/info/`` table, pivots far more out of it than the download
path reads, and dragged Prefect, duckdb, redis and pandera into the download
image behind it. These tests pin the parse to the predicate ``Dataset`` uses —
a variable is a row with no ``Attribute Name`` that is not ``NC_GLOBAL`` — so
the two cannot silently disagree about what a dataset's columns are.
"""

import pandas as pd

from erddap_downloader.download_erddap import (
    get_variable_list,
    get_variables_from_info,
)

INFO_COLUMNS = ["Row Type", "Variable Name", "Attribute Name", "Data Type", "Value"]

# A realistic tabledap /info/ table: globals, variables, and attribute rows —
# including a cf_role, which is the only attribute the download path reads.
INFO = pd.DataFrame(
    [
        ("attribute", "NC_GLOBAL", "cdm_data_type", "", "TimeSeries"),
        ("attribute", "NC_GLOBAL", "title", "", "Test Dataset"),
        ("variable", "time", "", "double", ""),
        ("attribute", "time", "units", "", "seconds since 1970-01-01T00:00:00Z"),
        ("variable", "latitude", "", "double", ""),
        ("variable", "longitude", "", "double", ""),
        ("variable", "depth", "", "double", ""),
        ("variable", "temperature", "", "double", ""),
        ("attribute", "temperature", "standard_name", "", "sea_water_temperature"),
        ("variable", "station_id", "", "String", ""),
        ("attribute", "station_id", "cf_role", "", "timeseries_id"),
    ],
    columns=INFO_COLUMNS,
)


class TestGetVariablesFromInfo:
    def test_every_variable_is_listed_once(self):
        variables = get_variables_from_info(INFO)
        assert variables["name"].to_list() == [
            "time",
            "latitude",
            "longitude",
            "depth",
            "temperature",
            "station_id",
        ]

    def test_globals_and_attributes_are_not_variables(self):
        names = get_variables_from_info(INFO)["name"].to_list()
        assert "NC_GLOBAL" not in names
        assert len(names) == len(set(names))

    def test_cf_role_is_carried_and_blank_elsewhere(self):
        variables = get_variables_from_info(INFO).set_index("name")
        assert variables.loc["station_id", "cf_role"] == "timeseries_id"
        # Blank, never NaN: get_variable_list's reduced path queries cf_role != ''.
        assert variables.loc["temperature", "cf_role"] == ""

    def test_a_griddap_dimension_row_counts_as_a_variable(self):
        """``Dataset``'s predicate is Attribute-Name-based, not Row-Type-based, so
        griddap dimensions are included — matching what it would have returned."""
        info = pd.concat(
            [
                INFO,
                pd.DataFrame(
                    [("dimension", "altitude", "", "double", "nValues=1")],
                    columns=INFO_COLUMNS,
                ),
            ],
            ignore_index=True,
        )
        assert "altitude" in get_variables_from_info(info)["name"].to_list()


class TestGetVariableList:
    def test_all_variables_by_default(self):
        variables = get_variables_from_info(INFO)
        assert get_variable_list(variables) == variables["name"].to_list()

    def test_reduced_set_is_coordinates_plus_cf_role(self):
        variables = get_variables_from_info(INFO)
        assert sorted(get_variable_list(variables, all_variables=False)) == [
            "depth",
            "latitude",
            "longitude",
            "station_id",
            "time",
        ]
