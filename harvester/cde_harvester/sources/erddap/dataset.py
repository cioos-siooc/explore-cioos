import logging
from datetime import UTC, datetime

import pandas as pd
import requests
from requests.exceptions import HTTPError

from cde_harvester.core.harvest_warnings import (
    UNKNOWN_PLATFORM_VOCABULARY,
    HarvestWarnings,
)
from cde_harvester.core.observability import run_logger
from cde_harvester.core.record_metadata import from_erddap_globals
from cde_harvester.core.variables import extract_variables
from cde_harvester.sources.erddap.platform_vocab import (
    PLATFORM_CATEGORIES,
    platform_category,
    platforms_nerc_ioos,
)
from cde_harvester.utils import (
    eov_standard_name,
    eov_to_standard_name,
    standard_name_to_eovs,
)


def is_valid_duration(duration):
    try:
        pd.Timedelta(duration)
        return True
    except (ValueError, TypeError):
        return False


# Attributes kept on df_variables when get_metadata() pivots the info frame;
# everything else ERDDAP publishes is dropped. Only ~18% of variables declare a
# colorBar palette, so consumers must have a default. tests/conftest.py imports
# this list so fixtures pivot exactly what production pivots.
CONSIDERED_VARIABLE_ATTRIBUTES = [
    "cf_role",
    "standard_name",
    "actual_range",
    "units",
    "long_name",
    "axis",
    "positive",
    "colorBarPalette",
    "colorBarMinimum",
    "colorBarMaximum",
    "colorBarScale",
    "colorBarContinuous",
    "ioos_category",
    "flag_values",
    "flag_meanings",
    "ancillary_variables",
]


class Dataset:
    def __init__(self, erddap_server, id, data_structure="table"):
        self.id = id
        self.erddap_server = erddap_server
        self.logger = self.get_logger()

        # "table" | "grid"; drives the cdm_data_type fallback for grids.
        self.data_structure = data_structure
        self.erddap_url = erddap_server.url
        self.erddap_csv_to_df = erddap_server.erddap_csv_to_df
        # Recorded in harvest_attempts so an ERDDAP admin can reproduce a failure.
        self.queried_urls = []
        self.warnings = HarvestWarnings(self.logger)
        self.cdm_data_type = ""
        self.globals = {}
        self.platform = "unknown"
        self.df_variables = None
        self.variables_list = []
        self.profile_variable_list = []
        self.timeseries_id_variable = ""
        self.profile_id_variable = ""
        self.trajectory_id_variable = ""
        self.num_columns = 0
        self.first_eov_column = ""
        self.content_hash = None
        # HASH_* code explaining a None content_hash
        self.content_hash_reason = None

        # Set by the Grid handler; None for tabledap types.
        self.df_info = None
        self.wms_url = None
        self.coverage_lat_min = None
        self.coverage_lat_max = None
        self.coverage_lon_min = None
        self.coverage_lon_max = None
        self.coverage_time_min = None
        self.coverage_time_max = None
        self.coverage_depth_min = None
        self.coverage_depth_max = None
        self.grid_variables = None
        self.grid_dimensions = None
        # From the allDatasets listing; for grids the dimension-derived value wins.
        self.listing_time_min = None
        self.listing_time_max = None
        self.table_variables = None

        self.get_metadata()

    def get_df(self):

        now = datetime.now(UTC)
        self.df = pd.DataFrame(
            {
                "title": [self.globals["title"]],
                "erddap_url": [self.erddap_url],
                "dataset_id": [self.id],
                "cdm_data_type": [self.cdm_data_type],
                "platform": [self.platform],
                "platform_category": [platform_category(self.platform)],
                "eovs": [self.eovs],
                "organizations": [self.organizations],
                "n_profiles": [len(self.profile_ids)],
                "profile_variables": [self.profile_variable_list],
                "timeseries_id_variable": self.timeseries_id_variable,
                "profile_id_variable": self.profile_id_variable,
                "trajectory_id_variable": self.trajectory_id_variable,
                "num_columns": len(self.df_variables),
                "first_eov_column": self.first_eov_column,
                "content_hash": [self.content_hash],
                "content_hash_reason": [self.content_hash_reason],
                "last_updated_at": [now],
                "verified_at": [now],
                "coverage_lat_min": [self.coverage_lat_min],
                "coverage_lat_max": [self.coverage_lat_max],
                "coverage_lon_min": [self.coverage_lon_min],
                "coverage_lon_max": [self.coverage_lon_max],
                # Runs after extract_features(), so grid values are already set.
                "coverage_time_min": [
                    self.coverage_time_min or self.listing_time_min],
                "coverage_time_max": [
                    self.coverage_time_max or self.listing_time_max],
                "coverage_depth_min": [self.coverage_depth_min],
                "coverage_depth_max": [self.coverage_depth_max],
                "table_variables": [self.table_variables],
                "grid_variables": [self.grid_variables],
                "grid_dimensions": [self.grid_dimensions],
                "wms_url": [self.wms_url],
                "metadata": [from_erddap_globals(self.globals)],
            }
        )

        return self.df

    def dataset_tabledap_query(self, url):
        return self.erddap_csv_to_df(
            "/tabledap/" + self.id + ".csv?" + url, dataset=self
        )

    def get_max_min(self, vars):
        """Per-profile min/max of the last of ``vars``, grouped by the rest."""
        url = f"{','.join(vars)}" + requests.utils.quote(
            f'&orderByMinMax("{",".join(vars)}")'
        )

        df = self.dataset_tabledap_query(url)

        if df.empty:
            return df

        last_var = vars[-1]
        index_vars = vars[0:-1]
        df["maxmin"] = ""
        min_column = last_var + "_min"
        max_column = last_var + "_max"
        df.iloc[::2, df.columns.get_loc("maxmin")] = max_column
        df.loc[df.maxmin != max_column, "maxmin"] = min_column

        df_min_max = df.pivot(
            index=index_vars, columns=["maxmin"], values=[last_var]
        ).reset_index()
        df_min_max.columns = index_vars + [min_column, max_column]
        df_min_max.set_index(index_vars, inplace=True)

        return df_min_max

    def get_profile_ids(self, collapse_time_profile_ids=False):
        df_variables = self.df_variables

        # e.g. {'profile_id': 'hakai_id', 'timeseries_id': 'station'}
        profile_variables = (
            df_variables.set_index("cf_role", drop=False)
            .query('cf_role != ""')[["cf_role", "name"]]["name"]
            .to_dict()
        )
        if collapse_time_profile_ids and profile_variables.get("profile_id") == "time":
            # One "profile" per record timestamp: enumerating them scans the
            # whole dataset (dap.oceannetworks.ca's sensor streams 504 or exceed
            # the size cap), only for the handler to collapse to timeseries.
            profile_variables.pop("profile_id")

        # sorted so the url is stable for query caching
        profile_variable_list = sorted(profile_variables.values())
        self.profile_variables = profile_variables

        self.timeseries_id_variable = profile_variables.get("timeseries_id")
        self.profile_id_variable = profile_variables.get("profile_id")
        self.trajectory_id_variable = profile_variables.get("trajectory_id")

        self.profile_variable_list = profile_variable_list

        if not profile_variables:
            return []

        # distinct() of the ids alone measured ~0.2s on every ONC and
        # cioospacific dataset tried; an orderByMinMax over time scans every
        # record and 504s on dap.oceannetworks.ca's long sensor streams.
        # Moving-feature lat/lon is left to tabledap_features: a distinct()
        # with it returns one row per GPS fix.
        identity = list(profile_variable_list)
        subset_variables = self.subset_variables()
        if set(profile_variable_list) <= subset_variables:
            # Served from the pre-built subset table, where a lat/lon is
            # per-feature by declaration, so it comes along for the bbox.
            identity += [
                v for v in ("latitude", "longitude")
                if v in subset_variables and v not in profile_variable_list
            ]
        profile_ids = self.dataset_tabledap_query(f"{','.join(identity)}&distinct()")

        if profile_ids.empty and "time" not in profile_variable_list:
            # ERDDAP drops rows whose requested columns are ALL missing, so a
            # cf_role column that is never filled (seagull-erddap's `platform`)
            # empties the distinct(). Pairing it with time keeps one row per
            # feature, and the time bounds come along.
            profile_ids = self.get_max_min(
                profile_variable_list + ["time"]
            ).reset_index()

        if profile_ids.empty:
            return profile_ids

        self.profile_ids = profile_ids.drop_duplicates(profile_variable_list)
        return profile_ids

    def subset_variables(self):
        return {
            v.strip() for v in self.globals.get("subsetVariables", "").split(",")
            if v.strip()
        }

    def get_count(self, vars, groupby, time_min, time_max):
        """Per-profile counts. A single-profile dataset counts 30 days and
        extrapolates (a full count takes forever at high frequency); with several
        profiles no one window is sure to overlap them all."""
        time_query = ""
        is_single_profile_dataset = len(self.profile_ids) == 1
        # parse_erddap_date returns tz-aware UTC; the fallback must match or
        # the subtraction below raises tz-naive/tz-aware TypeError.
        if str(time_min) == "NaT":
            time_min = datetime.now(UTC).isoformat()
        if str(time_max) == "NaT":
            time_max = datetime.now(UTC).isoformat()
        days_in_dataset = (pd.to_datetime(time_max) - pd.to_datetime(time_min)).days

        extraplolation_days = 30
        skip_full_count = (
            days_in_dataset >= extraplolation_days and is_single_profile_dataset
        )

        if skip_full_count:
            start_date = time_min.date()
            end_date = (
                pd.to_datetime(time_min) + pd.Timedelta(days=extraplolation_days)
            ).date()

            time_query = f"&time>={start_date}&time<={end_date}"

        url = ",".join(vars) + f'&orderByCount("{",".join(groupby)}")' + time_query

        try:
            df_count = self.dataset_tabledap_query(url)
        except HTTPError as e:
            response = e.response

            self.logger.error(
                f"HTTP ERROR during count: {response.status_code} {response.reason}"
            )
            return pd.DataFrame()

        if skip_full_count and not df_count.empty:
            count = df_count[["time"]].time[0]
            extrapolated_count = (int(count) / extraplolation_days) * days_in_dataset

            df_count.loc[0, "time"] = extrapolated_count

        return df_count

    def get_eovs(self):
        eovs = []
        eov_names = self.df_variables["standard_name"].map(eov_standard_name)

        for eov in eov_to_standard_name:
            eov_columns = self.df_variables.loc[
                eov_names.isin(eov_to_standard_name[eov])
            ]
            if not eov_columns.empty:
                # default column in the preview
                self.first_eov_column = eov_columns.iloc[0]["name"]
                eovs.append(eov)
        return eovs

    def get_eov_variables(self):
        """{variable name: [eov, ...]} for every variable mapped to an EOV."""
        eov_variables = {}
        for name, row in self.df_variables.iterrows():
            eovs = standard_name_to_eovs.get(eov_standard_name(row.get("standard_name")))
            if eovs:
                eov_variables[name] = eovs
        return eov_variables

    def get_platform_code(self):
        platform = self.globals.get("platform")
        platform_vocabulary = self.globals.get("platform_vocabulary")

        if not (platform and platform_vocabulary):
            self.logger.debug(
                "Found platform without platform_vocabulary, setting platform to 'unknown'"
            )
            return "unknown"

        if "ioos" in platform_vocabulary:
            try:
                return platforms_nerc_ioos.query(
                    f"ioos_label=='{platform}'"
                )["l06_label"].item()

            except ValueError:
                self.logger.error("Found unsupported IOOS platform: %s", platform)

        if "L06" in platform_vocabulary:
            l06_labels = {label.lower(): label for label in PLATFORM_CATEGORIES}
            if platform.lower() in l06_labels:
                return l06_labels[platform.lower()]
            self.logger.error("Found unsupported L06 platform: %s", platform)

        self.warnings.add(
            UNKNOWN_PLATFORM_VOCABULARY,
            f"Platform '{platform}' has no known vocabulary "
            f"(platform_vocabulary='{platform_vocabulary}'); set to 'unknown'",
            items=[platform],
        )
        return "unknown"

    def get_metadata(self):
        url = "/info/" + self.id + "/index.csv"
        # erddap_csv_to_df's skiprows defaults to (1,)
        df = self.erddap_csv_to_df(url, skiprows=[], dataset=self).fillna("")

        if df.empty:
            self.logger.error("Dataset metadata not found")
            return df

        # The Grid handler reads its "dimension"/"variable" rows.
        self.df_info = df

        # Read by the @-reference in the df.query() below, which ruff
        # cannot see into.
        considered_attributes = CONSIDERED_VARIABLE_ATTRIBUTES  # noqa: F841

        data_types = df.query(
            '(`Variable Name`!="NC_GLOBAL" and `Attribute Name`=="")'
        )[["Variable Name", "Data Type"]].set_index("Variable Name")
        attributes = (
            df.query("`Attribute Name` in @considered_attributes")[
                ["Variable Name", "Attribute Name", "Value"]
            ]
            .pivot(index="Variable Name", columns="Attribute Name", values="Value")
            .fillna("")
        )
        df_variables = data_types.join(attributes).fillna("")

        df_variables = df_variables.reset_index().rename(
            columns={
                "Variable Name": "name",
                "Data Type": "type",
            }
        )

        df_variables["erddap_url"] = self.erddap_url
        df_variables["dataset_id"] = self.id
        df_global = df.query('`Variable Name`=="NC_GLOBAL"')[
            ["Attribute Name", "Value"]
        ].set_index("Attribute Name")
        globals_dict = df_global["Value"].to_dict()

        self.variables_list = df_variables["name"].to_list()
        # Griddap datasets may omit cdm_data_type; for tabledap an empty string
        # fails the supported-type check downstream.
        self.cdm_data_type = globals_dict.get(
            "cdm_data_type", "Grid" if self.data_structure == "grid" else ""
        )
        self.globals = globals_dict

        if "standard_name" not in df_variables:
            df_variables["standard_name"] = None
        df_variables.set_index("name", drop=False, inplace=True)
        self.df_variables = df_variables
        # Every column, coordinates and cf_role variables included: the preview
        # needs those to choose a shared axis and to exclude them from panels.
        self.table_variables = extract_variables(df_variables)
        self.eovs = self.get_eovs()

        # https://wiki.esipfed.org/Attribute_Convention_for_Data_Discovery_1-3
        organization_fields = ["institution"]

        group_type = ["group", "institution"]

        if globals_dict.get("publisher_type") in group_type:
            organization_fields.append("publisher")

        if globals_dict.get("creator_type") in group_type:
            organization_fields.append("creator")

        if globals_dict.get("contributor_type") in group_type:
            organization_fields.append("contributor")

        self.organizations = list(
            filter(None, {globals_dict.get(x) for x in organization_fields})
        )

        self.platform = self.get_platform_code()

    def get_logger(self):
        return run_logger(
            logging.getLogger(f"{self.erddap_server.domain}.{self.id}")
        )
