"""Unit tests for cde_harvester.sources.erddap.compliance."""

import logging
from unittest.mock import MagicMock

from cde_harvester.core.errors import (
    DEPTH_AND_ALTITUDE,
    INGEST_FLAG_FALSE,
    MISSING_REQUIRED_VARS,
    NO_SUPPORTED_VARIABLES,
)
from cde_harvester.core.harvest_warnings import NON_CF_STANDARD_NAMES
from cde_harvester.sources.erddap.compliance import CDEComplianceChecker
from conftest import (
    ERDDAP_INFO_CSV,
    ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV,
    ERDDAP_INFO_INGEST_FALSE_CSV,
    ERDDAP_INFO_NO_EOVS_CSV,
    build_info_df,
    build_mock_dataset,
    build_variables_df,
)


def _checker(info_csv=ERDDAP_INFO_CSV, **overrides):
    """Build a CDEComplianceChecker from a mock dataset, with optional overrides."""
    dataset = build_mock_dataset(info_csv)
    for attr, value in overrides.items():
        setattr(dataset, attr, value)
    return CDEComplianceChecker(dataset)


class TestPassesAllChecks:
    def test_valid_timeseries_dataset_passes(self):
        checker = _checker()
        assert checker.passes_all_checks() is True

    def test_failure_reason_code_empty_on_pass(self):
        checker = _checker()
        checker.passes_all_checks()
        assert checker.failure_reason_code == ""


class TestRequiredVariables:
    def test_missing_time_fails(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "time"
        ]
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS

    def test_missing_latitude_fails(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "latitude"
        ]
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS

    def test_missing_longitude_fails(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "longitude"
        ]
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS

    def test_missing_variable_named_in_details(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "time"
        ]
        checker.check_required_variables()
        assert "destinationName time:" in checker.failure_details

    def test_empty_info_page_explained(self):
        checker = _checker(variables_list=[])
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS
        assert "lists no variables" in checker.failure_details

    def test_all_required_present_passes(self):
        checker = _checker()
        assert checker.check_required_variables() is True


# Modeled on salishsea.eos.ubc.ca ubcSSg3DPhysicsFields1hV21-11: indexed by
# gridY/gridX, its 2-D latitude/longitude live in a separate dataset.
CURVILINEAR_GRID_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,Grid
{globals}dimension,time,,double,"nValues=10, evenlySpaced=true, averageSpacing=1h 0m 0s"
attribute,time,actual_range,,"1.1676114E9, 1.7926254E9"
attribute,time,standard_name,,time
dimension,gridY,,short,"nValues=898, evenlySpaced=true, averageSpacing=1.0"
attribute,gridY,actual_range,,"0, 897"
dimension,gridX,,short,"nValues=398, evenlySpaced=true, averageSpacing=1.0"
attribute,gridX,actual_range,,"0, 397"
variable,temperature,,float,"time, gridY, gridX"
attribute,temperature,standard_name,,sea_water_temperature
"""

ACDD_BOUNDS = """\
attribute,NC_GLOBAL,geospatial_lat_min,double,46.86
attribute,NC_GLOBAL,geospatial_lat_max,double,51.11
attribute,NC_GLOBAL,geospatial_lon_min,double,-126.40
attribute,NC_GLOBAL,geospatial_lon_max,double,-121.32
"""

# Modeled on ubcSSnBathymetryV21-08: 2-D latitude/longitude data variables,
# which ERDDAP gives no actual_range.
COORDINATE_GRID_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,Grid
dimension,gridY,,int,"nValues=898, evenlySpaced=true, averageSpacing=1.0"
dimension,gridX,,short,"nValues=398, evenlySpaced=true, averageSpacing=1.0"
variable,bathymetry,,double,"gridY, gridX"
attribute,bathymetry,standard_name,,sea_floor_depth
variable,latitude,,double,"gridY, gridX"
attribute,latitude,standard_name,,latitude
variable,longitude,,double,"gridY, gridX"
attribute,longitude,standard_name,,longitude
"""


def _grid_checker(info_csv):
    # build_mock_dataset assumes a tabledap with cf_role variables.
    dataset = MagicMock()
    dataset.cdm_data_type = "Grid"
    dataset.logger = logging.getLogger("test.grid_compliance")
    dataset.df_variables = build_variables_df(info_csv)
    dataset.variables_list = dataset.df_variables["name"].tolist()
    info = build_info_df(info_csv)
    dataset.globals = (
        info.query('`Variable Name`=="NC_GLOBAL"')
        .set_index("Attribute Name")["Value"]
        .to_dict()
    )
    return CDEComplianceChecker(dataset)


class TestGridExtent:
    def test_regular_grid_axes_pass(self):
        checker = _grid_checker(
            CURVILINEAR_GRID_CSV.format(globals="")
            .replace("gridY", "latitude")
            .replace("gridX", "longitude")
        )
        assert checker.check_required_variables() is True

    def test_curvilinear_grid_with_acdd_bounds_passes(self):
        checker = _grid_checker(CURVILINEAR_GRID_CSV.format(globals=ACDD_BOUNDS))
        assert checker.check_required_variables() is True

    def test_curvilinear_grid_without_bounds_fails_with_guidance(self):
        checker = _grid_checker(CURVILINEAR_GRID_CSV.format(globals=""))
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS
        assert "geospatial_lat_min" in checker.failure_details
        assert "geospatial_lon_max" in checker.failure_details

    def test_2d_coordinate_variables_without_range_fail(self):
        checker = _grid_checker(COORDINATE_GRID_CSV)
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS

    def test_non_numeric_bound_fails(self):
        checker = _grid_checker(
            CURVILINEAR_GRID_CSV.format(
                globals=ACDD_BOUNDS.replace("-121.32", "east")
            )
        )
        assert checker.check_required_variables() is False
        assert checker.failure_details.startswith("No longitude extent")

    def test_tabledap_type_ignores_acdd_bounds(self):
        checker = _checker()
        checker.dataset.variables_list = ["time", "temperature"]
        checker.dataset.globals = {
            "geospatial_lat_min": "48", "geospatial_lat_max": "51",
            "geospatial_lon_min": "-126", "geospatial_lon_max": "-121",
        }
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS


class TestSupportedCFName:
    def test_dataset_with_sea_water_temperature_passes(self):
        checker = _checker()
        assert checker.check_supported_cf_name() is True

    def test_dataset_with_no_supported_standard_names_fails(self):
        checker = _checker(ERDDAP_INFO_NO_EOVS_CSV)
        assert checker.check_supported_cf_name() is False
        assert checker.failure_reason_code == NO_SUPPORTED_VARIABLES

    def test_modifier_is_valid_but_not_an_eov_measurement(self):
        checker = _checker()
        checker.dataset.df_variables.loc["temperature", "standard_name"] = (
            "sea_water_temperature status_flag"
        )

        assert checker.check_supported_cf_name() is False
        assert checker.failure_reason_code == NO_SUPPORTED_VARIABLES
        assert not checker.dataset.warnings

    def test_non_cf_name_is_recorded_as_a_warning(self):
        checker = _checker()
        checker.dataset.df_variables.loc["temperature", "standard_name"] = (
            "sea_water_temprature"
        )

        checker.check_supported_cf_name()
        [warning] = checker.dataset.warnings
        assert warning["code"] == NON_CF_STANDARD_NAMES
        assert warning["items"] == ["sea_water_temprature"]

    def test_ioos_qc_flag_names_are_not_flagged(self):
        checker = _checker()
        checker.dataset.df_variables.loc["temperature", "standard_name"] = (
            "sea_water_temperature_spike_test"
        )

        checker.check_supported_cf_name()
        assert not checker.dataset.warnings


class TestIngestFlag:
    def test_no_cde_ingest_flag_passes(self):
        checker = _checker()
        # globals has no cde_ingest key
        assert checker.cde_ingest_flag() is True

    def test_cde_ingest_false_fails(self):
        checker = _checker(ERDDAP_INFO_INGEST_FALSE_CSV)
        assert checker.cde_ingest_flag() is False
        assert checker.failure_reason_code == INGEST_FLAG_FALSE

    def test_cde_ingest_true_passes(self):
        checker = _checker()
        checker.dataset.globals["cde_ingest"] = "True"
        assert checker.cde_ingest_flag() is True


class TestDepthAndAltitude:
    def test_only_depth_passes(self):
        checker = _checker()
        assert "depth" in checker.dataset.variables_list
        assert "altitude" not in checker.dataset.variables_list
        assert checker.check_only_one_depth() is True

    def test_depth_and_altitude_together_fails(self):
        checker = _checker(ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV)
        assert checker.check_only_one_depth() is False
        assert checker.failure_reason_code == DEPTH_AND_ALTITUDE

    def test_only_altitude_passes(self):
        checker = _checker()
        checker.dataset.variables_list = [
            v for v in checker.dataset.variables_list if v != "depth"
        ] + ["altitude"]
        assert checker.check_only_one_depth() is True
