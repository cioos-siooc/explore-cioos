from cde_harvester.harvest_errors import (
    DEPTH_AND_ALTITUDE,
    INGEST_FLAG_FALSE,
    MISSING_REQUIRED_VARS,
    NO_SUPPORTED_VARIABLES,
)
from cde_harvester.utils import (
    cf_standard_names,
    intersection,
    supported_standard_names,
)


class CDEComplianceChecker(object):
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
        """Check if there are any supported (mapped to GOOS) CF standard names in
        the dataset."""

        standard_names_in_dataset = (
            self.dataset.df_variables.query("standard_name != ''")["standard_name"]
            .unique()
            .tolist()
        )

        #  List non-CF standard names
        non_standard_names = [
            x for x in standard_names_in_dataset if x not in cf_standard_names
        ]
        if non_standard_names:
            self.logger.warn(
                "Found unstandard standard_name:" + str(non_standard_names)
            )

        #  This dataset has at least one standard name mapped to GOOS
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
