from erddap_scraper.utils import (
    eov_to_standard_names,
    flatten,
    intersection,
    cf_standard_names,
)
from erddap_scraper.scrape_erddap import (
    MISSING_REQUIRED_VARS,
    NO_SUPPORTED_VARIABLES,
    INGEST_FLAG_FALSE,
    DEPTH_AND_ALTITUDE,
)


class CEDAComplianceChecker(object):
    def __init__(self, dataset):
        self.dataset = dataset
        self.logger = dataset.logger
        self.failure_reason_code = ""

    def failed_error(self, msg, failure_reason_code):
        self.logger.error("Skipping dataset:" + msg)
        self.failure_reason_code = failure_reason_code

    def check_required_variables(self):
        # make sure LLAT variables exist. Depth/Altitude is assumed to be 0 if it doesnt exist
        # https://coastwatch.pfeg.noaa.gov/erddap/download/setupDatasetsXml.html#LLAT
        required_variables = ["time", "latitude", "longitude"]

        missing_required_vars = [
            x for x in required_variables if x not in self.dataset.variables_list
        ]

        if missing_required_vars:
            self.failed_error(
                f"Can't find required variable: {missing_required_vars}",
                MISSING_REQUIRED_VARS,
            )
            return False
        return True

    def check_supported_cf_name(self):
        supported_standard_names = flatten(list(eov_to_standard_names.values()))
        standard_names_in_dataset = (
            self.dataset.df_variables.query("standard_name != ''")["standard_name"]
            .unique()
            .tolist()
        )
        non_standard_names = [
            x for x in standard_names_in_dataset if x not in cf_standard_names
        ]
        if non_standard_names:
            self.logger.warn(
                "Found unstandard standard_name:" + str(non_standard_names)
            )
        supported_variables = intersection(
            supported_standard_names,
            standard_names_in_dataset,
        )
        if not supported_variables:
            self.failed_error("No supported variables found", NO_SUPPORTED_VARIABLES)
            return False
        return True

    def cde_ingest_flag(self):
        """
        ERDDAP Admins can prevent a dataset from ingestion into CDE with cde_ingest=False
        """
        cde_ingest = self.dataset.globals.get("cde_ingest", "")

        if cde_ingest.lower() == "false":
            self.failed_error("cde_ingest=False", INGEST_FLAG_FALSE)
            return False
        return True

    def check_only_one_depth(self):
        if (
            "depth" in self.dataset.variables_list
            and "altitude" in self.dataset.variables_list
        ):
            self.failed_error("Found both depth and altitude", DEPTH_AND_ALTITUDE)
            return False
        return True

    def passes_all_checks(self):
        return (
            self.cde_ingest_flag()
            and self.check_required_variables()
            and self.check_supported_cf_name()
            and self.check_only_one_depth()
        )
