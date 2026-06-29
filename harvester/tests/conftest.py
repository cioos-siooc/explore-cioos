"""
Shared fixtures and mock data for the CIOOS harvester test suite.

All ERDDAP response fixtures are constructed to match the exact CSV format that
the real ERDDAP servers return, including the units row that gets skipped by
erddap_csv_to_df (skiprows=[1] for tabledap, skiprows=[] for /info/).
"""

import logging
from io import StringIO
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

# ---------------------------------------------------------------------------
# Sentry guard — sentry_sdk 2.x raises BadDsn when dsn="" (its silent fallback
# for dsn=None).  Patch init before any __main__ module is imported so module-
# level sentry_sdk.init() calls in the source tree are no-ops in tests.
# ---------------------------------------------------------------------------
_sentry_init_patcher = patch("sentry_sdk.init")
_sentry_init_patcher.start()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ERDDAP_URL = "https://test.erddap.com/erddap"
DOMAIN = "test.erddap.com"
DATASET_ID = "test_timeseries_001"
DATASET_ID_2 = "test_profile_001"

# Standard names that map to CDE EOVs (pulled from goos_eov_to_standard_name.json)
SUPPORTED_STANDARD_NAME = "sea_water_temperature"
UNSUPPORTED_STANDARD_NAME = "some_completely_fake_variable_xyz"


# ---------------------------------------------------------------------------
# ERDDAP CSV response fixtures
# Each multi-line string represents the raw HTTP response body.
# ---------------------------------------------------------------------------

# allDatasets endpoint — skiprows=[1, 2] skips the units row and type-hint row.
ERDDAP_ALL_DATASETS_CSV = """\
datasetID,cdm_data_type,accessible,dataStructure
(String),(String),(String),(String)
,,,
test_timeseries_001,TimeSeries,public,table
test_profile_001,Profile,public,table
test_unsupported_001,Point,public,table
"""

# /info/{id}/index.csv — skiprows=[] so the header is row 0, data starts row 1.
# Columns: Row Type | Variable Name | Attribute Name | Data Type | Value
ERDDAP_INFO_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,TimeSeries
attribute,NC_GLOBAL,title,,Test Temperature Dataset
attribute,NC_GLOBAL,institution,,Test Institution
variable,time,,double,
attribute,time,actual_range,,"2020-01-01T00:00:00Z,2025-01-01T00:00:00Z"
variable,latitude,,double,
variable,longitude,,double,
variable,depth,,double,
attribute,depth,actual_range,,"0.5,200.5"
variable,temperature,,double,
attribute,temperature,standard_name,,sea_water_temperature
variable,station_id,,String,
attribute,station_id,cf_role,,timeseries_id
"""

# Info CSV for a dataset that has no supported EOVs
ERDDAP_INFO_NO_EOVS_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,TimeSeries
attribute,NC_GLOBAL,title,,No EOV Dataset
attribute,NC_GLOBAL,institution,,Test Org
variable,time,,double,
attribute,time,actual_range,,"2020-01-01T00:00:00Z,2025-01-01T00:00:00Z"
variable,latitude,,double,
variable,longitude,,double,
variable,my_fake_var,,double,
attribute,my_fake_var,standard_name,,some_completely_fake_variable_xyz
variable,station_id,,String,
attribute,station_id,cf_role,,timeseries_id
"""

# Info CSV for a dataset with cde_ingest=False
ERDDAP_INFO_INGEST_FALSE_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,TimeSeries
attribute,NC_GLOBAL,title,,Excluded Dataset
attribute,NC_GLOBAL,institution,,Test Org
attribute,NC_GLOBAL,cde_ingest,,False
variable,time,,double,
variable,latitude,,double,
variable,longitude,,double,
variable,temperature,,double,
attribute,temperature,standard_name,,sea_water_temperature
variable,station_id,,String,
attribute,station_id,cf_role,,timeseries_id
"""

# Info CSV for a dataset with both depth AND altitude (should be excluded)
ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV = """\
Row Type,Variable Name,Attribute Name,Data Type,Value
attribute,NC_GLOBAL,cdm_data_type,,TimeSeries
attribute,NC_GLOBAL,title,,Depth+Altitude Dataset
attribute,NC_GLOBAL,institution,,Test Org
variable,time,,double,
variable,latitude,,double,
variable,longitude,,double,
variable,depth,,double,
variable,altitude,,double,
variable,temperature,,double,
attribute,temperature,standard_name,,sea_water_temperature
variable,station_id,,String,
attribute,station_id,cf_role,,timeseries_id
"""

# tabledap profile IDs (distinct) — skiprows=[1] skips the units row.
ERDDAP_PROFILE_IDS_CSV = """\
station_id,latitude,longitude
(String),(degrees_north),(degrees_east)
STATION_001,48.5,-125.0
"""

# 2-station variant for multi-profile tests
ERDDAP_PROFILE_IDS_TWO_CSV = """\
station_id,latitude,longitude
(String),(degrees_north),(degrees_east)
STATION_001,48.5,-125.0
STATION_002,49.0,-124.5
"""

# orderByMinMax for time, 2 stations — even rows = max, odd rows = min.
ERDDAP_TIME_MINMAX_CSV = """\
station_id,time
(String),(UTC)
STATION_001,2023-12-31T00:00:00Z
STATION_001,2020-01-01T00:00:00Z
STATION_002,2022-12-31T00:00:00Z
STATION_002,2021-01-01T00:00:00Z
"""

# orderByMinMax for depth, 2 stations
ERDDAP_DEPTH_MINMAX_CSV = """\
station_id,depth
(String),(m)
STATION_001,200.5
STATION_001,0.5
STATION_002,150.0
STATION_002,1.0
"""

# orderByCount for (depth, station_id, time) grouped by station_id
ERDDAP_COUNT_CSV = """\
depth,station_id,time
(count),(count),(count)
1000,STATION_001,1000
500,STATION_002,500
"""


# ---------------------------------------------------------------------------
# CKAN response fixture
# ---------------------------------------------------------------------------

CKAN_PACKAGE_SEARCH_RESPONSE = {
    "result": {
        "count": 1,
        "results": [
            {
                "id": "ckan-uuid-001",
                "title_translated": {
                    "en": "Test Dataset English Title",
                    "fr": "Test Dataset French Title",
                },
                "notes_translated": {
                    "en": "English summary.",
                    "fr": "French summary.",
                },
                "cited-responsible-party": [
                    {"organisation-name": "CIOOS Test Organization"}
                ],
                "resources": [
                    {
                        "url": (
                            "https://test.erddap.com/erddap/tabledap/"
                            "test_timeseries_001.html"
                        ),
                        "format": "ERDDAP tabledap",
                    }
                ],
            }
        ],
    }
}

# Empty CKAN response for second page (stops pagination)
CKAN_EMPTY_RESPONSE = {"result": {"count": 1, "results": []}}


# ---------------------------------------------------------------------------
# MockResponse — simulates a requests.Response object
# ---------------------------------------------------------------------------

class MockResponse:
    """Minimal requests.Response substitute for HTTP mocking."""

    def __init__(self, text="", status_code=200, url=None):
        self.text = text
        self.content = text.encode("utf-8") if isinstance(text, str) else text
        self.status_code = status_code
        self.url = url or ERDDAP_URL + "/mocked"

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.exceptions.HTTPError(response=self)


# ---------------------------------------------------------------------------
# URL routing helper — maps an ERDDAP request URL to a fixture CSV string
# ---------------------------------------------------------------------------

def _route_erddap_url(url: str) -> str:
    """Return the appropriate fixture CSV text for a given ERDDAP request URL."""
    from urllib.parse import unquote
    decoded = unquote(url)

    if "allDatasets" in decoded:
        return ERDDAP_ALL_DATASETS_CSV
    if "/info/" in decoded:
        return ERDDAP_INFO_CSV
    if "distinct()" in decoded:
        return ERDDAP_PROFILE_IDS_CSV
    if "orderByMinMax" in decoded:
        # distinguish time from depth by what appears before orderByMinMax
        pre = decoded.split("orderByMinMax")[0]
        if ",depth" in pre or "depth," in pre:
            return ERDDAP_DEPTH_MINMAX_CSV
        return ERDDAP_TIME_MINMAX_CSV
    if "orderByCount" in decoded:
        return ERDDAP_COUNT_CSV
    return ""


def make_mock_session_get(url, **kwargs):
    """side_effect for requests.Session.get that routes to fixture data."""
    text = _route_erddap_url(url)
    return MockResponse(text=text, url=url)


# ---------------------------------------------------------------------------
# Helpers to build DataFrames directly (bypassing HTTP) for unit tests
# ---------------------------------------------------------------------------

def build_info_df(csv_text: str = ERDDAP_INFO_CSV) -> pd.DataFrame:
    """Parse an ERDDAP info CSV string into a DataFrame as Dataset.get_metadata() would."""
    return pd.read_csv(StringIO(csv_text)).fillna("")


def build_variables_df(csv_text: str = ERDDAP_INFO_CSV) -> pd.DataFrame:
    """
    Build the df_variables DataFrame exactly as Dataset.get_metadata() does,
    so unit tests for ComplianceChecker / profiles can use a realistic object.
    """
    df = build_info_df(csv_text)
    considered_attributes = ["cf_role", "standard_name", "actual_range"]

    data_types = df.query(
        '(`Variable Name`!="NC_GLOBAL" and `Attribute Name`=="")'
    )[["Variable Name", "Data Type"]].set_index("Variable Name")

    attr_df = df.query("`Attribute Name` in @considered_attributes")[
        ["Variable Name", "Attribute Name", "Value"]
    ]
    if not attr_df.empty:
        attributes = attr_df.pivot(
            index="Variable Name", columns="Attribute Name", values="Value"
        ).fillna("")
    else:
        attributes = pd.DataFrame(index=data_types.index)

    df_variables = data_types.join(attributes).fillna("")
    df_variables = df_variables.reset_index().rename(
        columns={"Variable Name": "name", "Data Type": "type"}
    )
    df_variables["erddap_url"] = ERDDAP_URL
    df_variables["dataset_id"] = DATASET_ID
    if "standard_name" not in df_variables:
        df_variables["standard_name"] = ""
    if "cf_role" not in df_variables:
        df_variables["cf_role"] = ""
    if "actual_range" not in df_variables:
        df_variables["actual_range"] = ""
    df_variables.set_index("name", drop=False, inplace=True)
    return df_variables


def build_mock_dataset(
    info_csv: str = ERDDAP_INFO_CSV,
    cdm_data_type: str = "TimeSeries",
) -> MagicMock:
    """
    Build a realistic MagicMock Dataset with all attributes that
    CDEComplianceChecker and get_profiles depend on.
    """
    df_variables = build_variables_df(info_csv)
    variables_list = df_variables["name"].tolist()

    mock = MagicMock()
    mock.id = DATASET_ID
    mock.erddap_url = ERDDAP_URL
    mock.cdm_data_type = cdm_data_type
    mock.df_variables = df_variables
    mock.variables_list = variables_list
    mock.logger = logging.getLogger("test.mock_dataset")

    # Globals parsed from NC_GLOBAL attributes
    info_df = build_info_df(info_csv)
    global_rows = info_df.query('`Variable Name`=="NC_GLOBAL"')[
        ["Attribute Name", "Value"]
    ].set_index("Attribute Name")
    mock.globals = global_rows["Value"].to_dict()

    # EOVs — use the real utility to derive them
    from cde_harvester.utils import eov_to_standard_name, intersection
    eovs = []
    dataset_standard_names = df_variables["standard_name"].tolist()
    for eov, standard_names in eov_to_standard_name.items():
        if intersection(dataset_standard_names, standard_names):
            eovs.append(eov)
    mock.eovs = eovs

    mock.organizations = [mock.globals.get("institution", "")]
    mock.platform = "unknown"

    # profile_variables / profile_variable_list from cf_role column
    pv = (
        df_variables.query('cf_role != ""')
        .set_index("cf_role")["name"]
        .to_dict()
    )
    mock.profile_variables = pv
    mock.profile_variable_list = sorted(list(pv.values()))

    # timeseries_id / profile_id / trajectory_id
    mock.timeseries_id_variable = pv.get("timeseries_id")
    mock.profile_id_variable = pv.get("profile_id")
    mock.trajectory_id_variable = pv.get("trajectory_id")
    mock.first_eov_column = "temperature"

    # profile_ids DataFrame (single station for unit tests)
    profile_ids_df = pd.read_csv(
        StringIO(ERDDAP_PROFILE_IDS_CSV), skiprows=[1]
    )
    profile_ids_df["latlon"] = (
        profile_ids_df["latitude"].astype(str)
        + ","
        + profile_ids_df["longitude"].astype(str)
    )
    profile_ids_df = profile_ids_df.drop_duplicates(mock.profile_variable_list)
    del profile_ids_df["latlon"]
    mock.profile_ids = profile_ids_df

    # get_profile_ids() returns the same DataFrame
    mock.get_profile_ids.return_value = profile_ids_df.copy()

    # get_max_min() — return per-variable DataFrames
    def _get_max_min(vars_list):
        last_var = vars_list[-1]
        index_vars = vars_list[:-1]
        if last_var == "time":
            data = {
                "station_id": ["STATION_001"],
                "time_min": ["2020-01-01T00:00:00Z"],
                "time_max": ["2023-12-31T00:00:00Z"],
            }
        else:
            data = {
                "station_id": ["STATION_001"],
                f"{last_var}_min": [0.5],
                f"{last_var}_max": [200.5],
            }
        df = pd.DataFrame(data).set_index(index_vars)
        return df

    mock.get_max_min.side_effect = _get_max_min

    # get_count() — return counts indexed by profile variable
    count_df = pd.DataFrame(
        {"depth": [1000], "station_id": ["STATION_001"], "time": [1000]}
    )
    mock.get_count.return_value = count_df

    # get_df() — DataFrame row for the datasets CSV
    mock.get_df.return_value = pd.DataFrame(
        {
            "title": ["Test Temperature Dataset"],
            "erddap_url": [ERDDAP_URL],
            "dataset_id": [DATASET_ID],
            "cdm_data_type": [cdm_data_type],
            "platform": ["unknown"],
            "eovs": [mock.eovs],
            "organizations": [mock.organizations],
            "n_profiles": [1],
            "profile_variables": [mock.profile_variable_list],
            "timeseries_id_variable": [mock.timeseries_id_variable],
            "profile_id_variable": [mock.profile_id_variable],
            "trajectory_id_variable": [mock.trajectory_id_variable],
            "num_columns": [len(df_variables)],
            "first_eov_column": ["temperature"],
        }
    )
    return mock


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_dataset():
    """Realistic MagicMock Dataset for compliance and profile unit tests."""
    return build_mock_dataset()


@pytest.fixture
def mock_erddap_server(mocker):
    """
    Mocked ERDDAP server object. Provides the interface that Dataset.__init__
    calls (url, domain, erddap_csv_to_df) without making any real HTTP calls.
    """
    server = MagicMock()
    server.url = ERDDAP_URL
    server.domain = DOMAIN

    def _erddap_csv_to_df(url, skiprows=None, dataset=None):
        if "/info/" in url:
            return pd.read_csv(StringIO(ERDDAP_INFO_CSV)).fillna("")
        return pd.DataFrame()

    server.erddap_csv_to_df.side_effect = _erddap_csv_to_df
    return server


@pytest.fixture
def sample_datasets_df():
    """A minimal datasets DataFrame as produced by harvest_erddap."""
    return pd.DataFrame(
        {
            "title": ["Test Temperature Dataset"],
            "erddap_url": [ERDDAP_URL],
            "dataset_id": [DATASET_ID],
            "cdm_data_type": ["TimeSeries"],
            "platform": ["unknown"],
            "eovs": [["seaSurfaceTemperature"]],
            "organizations": [["Test Institution"]],
            "n_profiles": [1],
            "profile_variables": [["station_id"]],
            "timeseries_id_variable": ["station_id"],
            "profile_id_variable": [None],
            "trajectory_id_variable": [None],
            "num_columns": [6],
            "first_eov_column": ["temperature"],
        }
    )


@pytest.fixture
def sample_profiles_df():
    """A minimal profiles DataFrame as produced by get_profiles."""
    return pd.DataFrame(
        {
            "timeseries_id": ["STATION_001"],
            "profile_id": [""],
            "latitude": [48.5],
            "longitude": [-125.0],
            "time_min": [pd.Timestamp("2020-01-01", tz="UTC")],
            "time_max": [pd.Timestamp("2023-12-31", tz="UTC")],
            "depth_min": [0.5],
            "depth_max": [200.5],
            "n_records": [1000.0],
            "records_per_day": [0.7519],
            "dataset_id": [DATASET_ID],
            "erddap_url": [ERDDAP_URL],
        }
    )


@pytest.fixture
def sample_variables_df():
    """Variable-level DataFrame as produced during harvest."""
    return build_variables_df()


@pytest.fixture
def sample_skipped_df():
    """Skipped datasets DataFrame."""
    return pd.DataFrame(
        {
            "erddap_url": [DOMAIN],
            "dataset_id": ["skipped_001"],
            "reason_code": ["NO_SUPPORTED_VARIABLES"],
        }
    )
