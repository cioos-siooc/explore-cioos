from datetime import datetime

import numpy as np
import pandas as pd
import requests
from cde_harvester.platform_ioos_to_l06 import platforms_nerc_ioos
from cde_harvester.utils import cde_eov_to_standard_name, intersection
from loguru import logger
from requests.exceptions import HTTPError


def is_valid_duration(duration):
    try:
        pd.Timedelta(duration)
        return True
    except:
        return False


class Dataset:
    def __init__(self, erddap_server, id):
        self.id = id
        self.erddap_server = erddap_server
        self.logger = logger.bind(erddap_url=erddap_server.url, dataset_id=id)

        self.erddap_url = erddap_server.url
        self.erddap_csv_to_df = erddap_server.erddap_csv_to_df
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

        self.get_metadata()

    def __repr__(self):
        return f"Dataset(erddap='{self.erddap_server.url}' datasetID='{self.id}')"

    def get_df(self):
        self.df = pd.DataFrame(
            {
                "title": [self.globals["title"]],
                # "summary": [self.globals["summary"]],
                "erddap_url": [self.erddap_url],
                "dataset_id": [self.id],
                "cdm_data_type": [self.cdm_data_type],
                "platform": [self.platform],
                "eovs": [self.eovs],
                "organizations": [self.organizations],
                "n_profiles": [len(self.profile_ids)],
                "profile_variables": [self.profile_variable_list],
                "timeseries_id_variable": self.timeseries_id_variable,
                "profile_id_variable": self.profile_id_variable,
                "trajectory_id_variable": self.trajectory_id_variable,
                "num_columns": len(self.df_variables),
                "first_eov_column": self.first_eov_column,
            }
        )

        return self.df

    def dataset_tabledap_query(self, url):
        return self.erddap_csv_to_df(
            "/tabledap/" + self.id + ".csv?" + url, dataset=self
        )

    def get_max_min(self, vars):
        """
        Get max/min values for each of certain variables, in each profile
        usually time,depth (lat/long are handle differently since the min of lat,lon might not be a point in the dataset)
        """

        url = f"{','.join(vars)}" + requests.utils.quote(
            f'&orderByMinMax("{",".join(vars)}")'
        )

        df = self.dataset_tabledap_query(url)

        # something went wrong
        if df.empty:
            return df

        # first_var = vars[0]
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

    def get_profile_ids(self):
        df_variables = self.df_variables

        # Organize dataset variables by their cf_roles
        # eg profile_variable={'profile_id': 'hakai_id', 'timeseries_id': 'station'}
        profile_variables = (
            df_variables.set_index("cf_role", drop=False)
            .query('cf_role != ""')[["cf_role", "name"]]["name"]
            .to_dict()
        )
        lat_lng = ["latitude", "longitude"]

        # sorting so the url is consistent every time for query caching
        profile_variable_list = sorted(list(profile_variables.values()))
        self.profile_variables = profile_variables

        self.timeseries_id_variable = profile_variables.get("timeseries_id")
        self.profile_id_variable = profile_variables.get("profile_id")
        self.trajectory_id_variable = profile_variables.get("trajectory_id")

        self.profile_variable_list = profile_variable_list

        if not profile_variables:
            return []

        # dropna - for when there are nulls in the lat/lon column leading to a second profile created
        profile_ids = self.dataset_tabledap_query(
            f"{','.join(profile_variable_list + lat_lng)}&distinct()"
        )

        if profile_ids.empty:
            return profile_ids

        profile_ids = profile_ids.dropna(subset=["latitude", "longitude"]).assign(
            latlon=lambda x: f"{x.latitude},{x.longitude}"
        )

        profiles_with_multiple_locations = (
            profile_ids.groupby(profile_variable_list)
            .count()[["latlon"]]
            .query("latlon>1")
            .index.to_list()
        )

        del profile_ids["latlon"]

        profile_ids = profile_ids.drop_duplicates(profile_variable_list)

        if profiles_with_multiple_locations:
            self.logger.warning(
                "Non unique lat/lon found within profiles: {}",
                profiles_with_multiple_locations,
            )

        self.profile_ids = profile_ids
        return profile_ids

    def get_count(self, vars, groupby, time_min, time_max):
        """
        Get count for each of certain variables, in each profile
        counting for a single day and extrapolating, otherwise this takes forever on high frequency datasets
        if its a single profile, get a single day. If its multple profiles it could be hard to pick a day that
        each profile has data for, and the profiles could be sequential with no time overlap
        def get_count(self, vars, groupby):
        """
        time_query = ""
        is_single_profile_dataset = len(self.profile_ids) == 1
        if str(time_min) == "NaT":
            time_min = datetime.now().isoformat()
        if str(time_max) == "NaT":
            time_max = datetime.now().isoformat()
        days_in_dataset = (pd.to_datetime(time_max) - pd.to_datetime(time_min)).days

        # Estimate records count per profile using time_coverage_resolution
        # For now this is only used with single-profile datasets
        # TODO use each profile's min/max time and then it can be used for any
        # dataset using time_coverage_resolution
        time_coverage_resolution = self.globals.get("time_coverage_resolution")

        if (
            is_single_profile_dataset
            and time_coverage_resolution
            and is_valid_duration(time_coverage_resolution)
        ):
            self.logger.debug(f"Using time_coverage_resolution for count")
            df_profile_ids = self.profile_ids.copy()
            readings_per_day = np.timedelta64(1, "D") / pd.Timedelta(
                time_coverage_resolution
            )
            total_records = readings_per_day * days_in_dataset
            df_profile_ids["time"] = total_records
            return df_profile_ids

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

        # Dont fail the dataset when the count fails
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

            df_count.loc[0, "time"] = int(extrapolated_count)

        return df_count

    def get_eovs(self):
        eovs = []
        dataset_standard_names = self.df_variables["standard_name"].to_list()

        for eov in cde_eov_to_standard_name:
            overlap = intersection(
                dataset_standard_names, cde_eov_to_standard_name[eov]
            )
            if overlap:
                # check if list of standard names in this EOV overlaps with list of standard names in this dataset

                # set first_eov_column, which is used to set default column in preview
                first_standard_name = overlap[0]
                self.first_eov_column = (
                    self.df_variables.query(f"standard_name=='{first_standard_name}'")
                    .head(1)["name"]
                    .item()
                )
                eovs.append(eov)
        return eovs

    def get_platform_code(self):
        platform = self.globals["platform"]
        platform_vocabulary = self.globals.get("platform_vocabulary")

        if not (platform and platform_vocabulary):
            self.logger.debug(
                "Found platform without platform_vocabulary, setting platform to 'unknown'"
            )
            return "unknown"

        if "ioos" in platform_vocabulary:
            try:
                l06_platform_label = platforms_nerc_ioos.query(
                    f"ioos_label=='{platform}'"
                )["category"].item()

                return l06_platform_label

            except ValueError:
                self.logger.error("Found unsupported IOOS platform: {}", platform)

        if "L06" in platform_vocabulary:
            platforms_nerc_ioos_no_duplicates = platforms_nerc_ioos.drop_duplicates(
                subset=["l06_label"]
            )

            if platform in list(platforms_nerc_ioos["l06_label"]):
                return platforms_nerc_ioos_no_duplicates.query(
                    f"l06_label=='{platform}'"
                )["category"].item()
            else:
                self.logger.error("Found unsupported L06 platform: %s", platform)

    def get_metadata(self):
        "get all the global and variable metadata for a dataset"

        # transform this JSON to an easier to use format
        url = "/info/" + self.id + "/index.csv"
        # erddap_csv_to_df's skiprows defaults to [1]
        df = self.erddap_csv_to_df(url, skiprows=[], dataset=self).fillna("")

        if df.empty:
            self.logger.error("Dataset metadata not found")
            return df

        considered_attributes = ["cf_role", "standard_name", "actual_range"]

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
        self.cdm_data_type = globals_dict["cdm_data_type"]
        self.globals = globals_dict

        if not "standard_name" in df_variables:
            df_variables["standard_name"] = None
        df_variables.set_index("name", drop=False, inplace=True)
        self.df_variables = df_variables
        self.eovs = self.get_eovs()

        # Try to get organizations list from globals, starting with "institution"
        # See https://wiki.esipfed.org/Attribute_Convention_for_Data_Discovery_1-3
        organization_fields = ["institution"]

        group_type = ["group", "institution"]

        if globals_dict.get("publisher_type") in group_type:
            organization_fields.append("publisher")

        if globals_dict.get("creator_type") in group_type:
            organization_fields.append("creator")

        if globals_dict.get("contributor_type") in group_type:
            organization_fields.append("contributor")

        self.organizations = list(
            filter(None, set([globals_dict.get(x) for x in organization_fields]))
        )

        if self.globals.get("platform"):
            self.platform = self.get_platform_code()
