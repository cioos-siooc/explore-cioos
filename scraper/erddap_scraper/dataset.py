import pandas as pd
import requests
import logging

logging.getLogger("urllib3").setLevel(logging.WARNING)


class Dataset(object):
    def __init__(self, erddap_server, id):
        self.id = id
        self.erddap_server = erddap_server
        self.erddap_url = erddap_server.url
        self.erddap_csv_to_df = erddap_server.erddap_csv_to_df
        self.cdm_data_type = ""
        self.globals = {}
        self.df_variables = None
        self.variables_list = []
        self.logger = self.get_logger()
        self.get_metadata()
        self.df = pd.DataFrame(
            {
                "erddap_url": [self.erddap_url],
                "dataset_id": [self.id],
                "cdm_data_type": [self.cdm_data_type],
            }
        )

    def dataset_tabledap_query(self, url):
        return self.erddap_server.erddap_csv_to_df(
            "/tabledap/" + self.id + ".csv?" + url
        )

    def get_max_min(self, vars, max_min):
        """Get max/min values for each of certain variables, in each profile
        usually time,lat,long,depth
        """

        url = f"{','.join(vars)}" + requests.utils.quote(
            f'&orderBy{max_min}("{",".join(vars)}")'
        )
        return self.dataset_tabledap_query(url)

    def get_profile_ids(self, profile_variable):
        if not profile_variable:
            return []
        return self.dataset_tabledap_query(f"{profile_variable}&distinct()")

    # Get count for each of certain variables, in each profile
    def get_count(self, vars, groupby):
        url = f"{','.join(vars)}" + requests.utils.quote(
            f'&orderByCount("{",".join(groupby)}")'
        )
        return self.dataset_tabledap_query(url)

    def get_data_access_form_url(self):
        return self.erddap_url + "/tabledap/" + self.id + ".html"

    def get_metadata(self):
        "get all the global and variable metadata for a dataset"

        # transform this JSON to an easier to use format
        url = "/info/" + self.id + "/index.csv"
        # erddap_csv_to_df's skiprows defaults to [1]
        df = self.erddap_csv_to_df(url, skiprows=[]).fillna("")

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
        df_variables = (
            data_types.join(attributes)
            .fillna("")
            .rename(
                columns={
                    "Variable Name": "variable",
                    "Data Type": "type",
                }
            )
            .reset_index()
            .set_index("Variable Name", drop=False)
        )
        df_variables["erddap_url"] = self.erddap_url
        df_variables["dataset_id"] = self.id
        df_global = df.query('`Variable Name`=="NC_GLOBAL"')[
            ["Attribute Name", "Value"]
        ].set_index("Attribute Name")
        globals_dict = df_global["Value"].to_dict()

        self.variables_list = df_variables["Variable Name"].to_list()
        self.cdm_data_type = globals_dict["cdm_data_type"]
        self.globals = globals_dict
        self.df_variables = df_variables
      
    def get_logger(self):
        logger = logging.getLogger(f"{self.erddap_server.domain} - {self.id}")
        return logger