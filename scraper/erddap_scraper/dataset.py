import logging
from datetime import datetime

import pandas as pd
import requests
from erddap_scraper.utils import eov_to_standard_names, intersection, eovs_to_ceda_eovs
from requests.exceptions import HTTPError


class Dataset(object):
    def __init__(self, erddap_server, id):
        self.id = id
        self.erddap_server = erddap_server
        self.logger = self.get_logger()

        self.erddap_url = erddap_server.url
        self.erddap_csv_to_df = erddap_server.erddap_csv_to_df
        self.cdm_data_type = ""
        self.globals = {}
        self.df_variables = None
        self.variables_list = []
        self.profile_variable_list = []

        self.get_metadata()
        self.profile_ids = self.get_profile_ids()

        self.df = pd.DataFrame(
            {
                "title": [self.globals["title"]],
                # "title_fr": [self.globals.get("title_fr")],
                "summary": [self.globals["title"]],
                # "summary_fr": [self.globals.get("abstract_fr")],
                "erddap_url": [self.erddap_url],
                "dataset_id": [self.id],
                "cdm_data_type": [self.cdm_data_type],
                "eovs": [self.eovs],
                "ceda_eovs": [eovs_to_ceda_eovs(self.eovs)],
                "organizations": [self.organizations],
                "n_profiles": [len(self.profile_ids)],
                "profile_variables": [self.profile_variable_list],
            }
        )

    def dataset_tabledap_query(self, url):
        return self.erddap_server.erddap_csv_to_df(
            "/tabledap/" + self.id + ".csv?" + url, logger=self.logger
        )

    def get_max_min(self, vars, max_min):
        """Get max/min values for each of certain variables, in each profile
        usually time,lat,long,depth
        """

        url = f"{','.join(vars)}" + requests.utils.quote(
            f'&orderBy{max_min}("{",".join(vars)}")'
        )
        return self.dataset_tabledap_query(url)

    def get_profile_ids(self):
        df_variables = self.df_variables

        # Organize dataset variables by their cf_roles
        # eg profile_variable={'profile_id': 'hakai_id', 'timeseries_id': 'station'}
        profile_variables = (
            df_variables.set_index("cf_role", drop=False)
            .query('cf_role != ""')[["cf_role", "name"]]["name"]
            .to_dict()
        )
        profile_variable_list = list(profile_variables.values())

        # sorting so the url is consistent every time for query caching
        profile_variable_list.sort()

        self.profile_variables = profile_variables
        self.profile_variable_list = profile_variable_list

        if not profile_variables:
            return []
        profile_ids = self.dataset_tabledap_query(
            f"{','.join(profile_variable_list)}&distinct()"
        )

        self.profile_ids = profile_ids
        return profile_ids

    # Get count for each of certain variables, in each profile
    # counting for a single day and extrapolating, otherwise this takes forever on high frequency datasets
    # if its a single profile, get a single day. If its multple profiles it could be hard to pick a day that
    # each profile has data for, and the profiles could be sequential with no time overlap
    # def get_count(self, vars, groupby):
    def get_count(self, vars, groupby, time_min, time_max):
        time_query = ""
        if str(time_min) == "NaT":
            time_min = datetime.now().isoformat()
        if str(time_max) == "NaT":
            time_max = datetime.now().isoformat()
        days_in_dataset = (pd.to_datetime(time_max) - pd.to_datetime(time_min)).days

        extraplolation_days = 30
        skip_full_count = (
            days_in_dataset >= extraplolation_days and len(self.profile_ids) == 1
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

            df_count.loc[0, "time"] = extrapolated_count

        return df_count

    def get_data_access_form_url(self):
        return self.erddap_url + "/tabledap/" + self.id + ".html"

    def get_eovs(self):
        eovs = []
        dataset_standard_names = self.df_variables["standard_name"].to_list()
        for eov in eov_to_standard_names:
            if intersection(dataset_standard_names, eov_to_standard_names[eov]):
                eovs.append(eov)
        return eovs

    def get_metadata(self):
        "get all the global and variable metadata for a dataset"

        # transform this JSON to an easier to use format
        url = "/info/" + self.id + "/index.csv"
        # erddap_csv_to_df's skiprows defaults to [1]
        df = self.erddap_csv_to_df(url, skiprows=[], logger=self.logger).fillna("")

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

    def get_logger(self):
        logger = logging.getLogger(f"{self.erddap_server.domain} - {self.id}")
        return logger
