"""Unit tests for the griddap handler (cde_harvester.dataset_types.grid)."""

import logging
from io import StringIO
from unittest.mock import MagicMock

import pandas as pd
import pytest

from cde_harvester.dataset_types.grid import (
    GridHandler,
    extract_grid_extent,
    normalize_lon_extent,
)
from conftest import ERDDAP_URL, build_info_df, build_variables_df

# Modeled on erddap.ogsl.ca/erddap/info/mpoChloroSatellitesAqua/index.csv —
# the exact CSV shape ERDDAP emits for a griddap dataset (dimension rows carry
# nValues/evenlySpaced/averageSpacing in Value; variable rows carry the
# dimension list).
GRID_INFO_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,Grid
attribute,NC_GLOBAL,title,,Test Grid Dataset
attribute,NC_GLOBAL,institution,,Test Institution
attribute,NC_GLOBAL,geospatial_lat_min,double,45.20833
attribute,NC_GLOBAL,geospatial_lat_max,double,51.875
attribute,NC_GLOBAL,geospatial_lon_min,double,-70.79166
attribute,NC_GLOBAL,geospatial_lon_max,double,-55.45833
attribute,NC_GLOBAL,time_coverage_start,,2002-07-04
attribute,NC_GLOBAL,time_coverage_end,,2020-07-31
dimension,time,,double,"nValues=5827, evenlySpaced=false, averageSpacing=1 day 3h 11m 48s"
attribute,time,actual_range,,"1.0257408E9, 1.5961536E9"
attribute,time,standard_name,,time
attribute,time,units,,seconds since 1970-01-01T00:00:00Z
dimension,latitude,,float,"nValues=80, evenlySpaced=true, averageSpacing=0.08438822784810131"
attribute,latitude,actual_range,,"45.20833, 51.875"
attribute,latitude,standard_name,,latitude
attribute,latitude,units,,degrees_north
dimension,longitude,,float,"nValues=184, evenlySpaced=true, averageSpacing=0.08378868852459015"
attribute,longitude,actual_range,,"-70.79166, -55.45833"
attribute,longitude,standard_name,,longitude
attribute,longitude,units,,degrees_east
variable,chl_a,,float,"time, latitude, longitude"
attribute,chl_a,standard_name,,concentration_of_chlorophyll_in_sea_water
attribute,chl_a,long_name,,Chlorophyll-a
attribute,chl_a,units,,mg m-3
"""

# A static grid: no time dimension, no time coverage globals.
STATIC_GRID_INFO_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,Grid
attribute,NC_GLOBAL,title,,Static Grid Dataset
attribute,NC_GLOBAL,institution,,Test Institution
dimension,latitude,,float,"nValues=100, evenlySpaced=true, averageSpacing=0.01"
attribute,latitude,actual_range,,"48.0, 49.0"
attribute,latitude,units,,degrees_north
dimension,longitude,,float,"nValues=100, evenlySpaced=true, averageSpacing=0.01"
attribute,longitude,actual_range,,"-69.0, -68.0"
attribute,longitude,units,,degrees_east
variable,substrate,,float,"latitude, longitude"
attribute,substrate,standard_name,,sea_floor_sediment_grain_size
attribute,substrate,units,,m
"""

# A grid with no lat/lon extent anywhere — must be skipped.
NO_EXTENT_GRID_INFO_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,Grid
attribute,NC_GLOBAL,title,,Broken Grid Dataset
dimension,latitude,,float,"nValues=100, evenlySpaced=true, averageSpacing=0.01"
attribute,latitude,units,,degrees_north
dimension,longitude,,float,"nValues=100, evenlySpaced=true, averageSpacing=0.01"
attribute,longitude,units,,degrees_east
variable,substrate,,float,"latitude, longitude"
attribute,substrate,units,,m
"""


def build_grid_dataset(info_csv=GRID_INFO_CSV):
    """Fake Dataset carrying the attributes extract_grid_extent reads."""
    dataset = MagicMock()
    dataset.id = "test_grid_001"
    dataset.erddap_url = ERDDAP_URL
    dataset.logger = logging.getLogger("test.grid_dataset")
    dataset.df_info = build_info_df(info_csv)
    dataset.df_variables = build_variables_df(info_csv)
    global_rows = dataset.df_info.query('`Variable Name`=="NC_GLOBAL"')[
        ["Attribute Name", "Value"]
    ].set_index("Attribute Name")
    dataset.globals = global_rows["Value"].to_dict()
    return dataset


class TestNormalizeLonExtent:
    def test_regular_extent_unchanged(self):
        assert normalize_lon_extent(-70.79166, -55.45833) == (-70.79166, -55.45833)

    def test_zero_to_360_becomes_global(self):
        assert normalize_lon_extent(0.0, 360.0) == (-180.0, 180.0)

    def test_span_over_360_becomes_global(self):
        assert normalize_lon_extent(-10.0, 370.0) == (-180.0, 180.0)

    def test_0_360_axis_wraps_and_marks_crossing(self):
        # 0.5..359.5 on a 0-360 axis crosses the antimeridian once wrapped:
        # min > max marks it for the DB's split-envelope generated column.
        lon_min, lon_max = normalize_lon_extent(0.5, 359.5)
        assert (lon_min, lon_max) == (0.5, -0.5)
        assert lon_min > lon_max

    def test_pacific_crossing(self):
        assert normalize_lon_extent(170.0, 190.0) == (170.0, -170.0)

    def test_exact_180_east_bound_stays_180(self):
        assert normalize_lon_extent(100.0, 180.0) == (100.0, 180.0)


class TestExtractGridExtent:
    def test_extent_and_metadata(self):
        dataset = build_grid_dataset()
        df = extract_grid_extent(dataset)

        assert not df.empty
        assert dataset.profile_ids == []
        assert dataset.coverage_lat_min == pytest.approx(45.20833)
        assert dataset.coverage_lat_max == pytest.approx(51.875)
        assert dataset.coverage_lon_min == pytest.approx(-70.79166)
        assert dataset.coverage_lon_max == pytest.approx(-55.45833)

    def test_dimensions_parsed_in_order(self):
        dataset = build_grid_dataset()
        extract_grid_extent(dataset)

        dims = dataset.grid_dimensions
        assert [d["name"] for d in dims] == ["time", "latitude", "longitude"]
        assert [d["n_values"] for d in dims] == [5827, 80, 184]
        time_dim = dims[0]
        assert time_dim["even_spacing"] is False
        assert time_dim["spacing"] == "1 day 3h 11m 48s"
        # epoch-seconds actual_range converted to ISO-8601 UTC
        assert time_dim["min"] == "2002-07-04T00:00:00+00:00"
        assert time_dim["max"] == "2020-07-31T00:00:00+00:00"
        lat_dim = dims[1]
        assert lat_dim["min"] == pytest.approx(45.20833)
        assert lat_dim["max"] == pytest.approx(51.875)
        assert lat_dim["units"] == "degrees_north"

    def test_variables_exclude_dimensions(self):
        dataset = build_grid_dataset()
        extract_grid_extent(dataset)

        assert dataset.grid_variables == [
            {
                "name": "chl_a",
                "standard_name": "concentration_of_chlorophyll_in_sea_water",
                "long_name": "Chlorophyll-a",
                "units": "mg m-3",
                "eovs": ["phytoplanktonBiomassAndDiversity", "oceanColour"],
            }
        ]

    def test_time_coverage_from_time_dimension(self):
        dataset = build_grid_dataset()
        extract_grid_extent(dataset)
        # actual_range (exact node values) wins over the date-only globals
        assert dataset.coverage_time_min == "2002-07-04T00:00:00+00:00"
        assert dataset.coverage_time_max == "2020-07-31T00:00:00+00:00"

    def test_static_grid_has_no_time_coverage(self):
        dataset = build_grid_dataset(STATIC_GRID_INFO_CSV)
        df = extract_grid_extent(dataset)

        assert not df.empty
        assert dataset.coverage_time_min is None
        assert dataset.coverage_time_max is None
        assert [d["name"] for d in dataset.grid_dimensions] == [
            "latitude", "longitude",
        ]

    def test_no_extent_returns_empty_frame(self):
        dataset = build_grid_dataset(NO_EXTENT_GRID_INFO_CSV)
        df = extract_grid_extent(dataset)
        assert df.empty

    def test_handler_registration_attributes(self):
        handler = GridHandler()
        assert handler.cdm_data_type == "Grid"
        assert handler.data_structure == "grid"
        assert handler.feature_kind == "dataset_extent"
