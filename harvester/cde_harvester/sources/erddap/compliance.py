from cde_harvester.core.errors import (
    DEPTH_AND_ALTITUDE,
    INGEST_FLAG_FALSE,
    MISSING_REQUIRED_VARS,
    NO_SUPPORTED_VARIABLES,
)
from cde_harvester.core.harvest_warnings import NON_CF_STANDARD_NAMES
from cde_harvester.utils import (
    eov_standard_name,
    intersection,
    is_cf_standard_name,
    supported_standard_names,
)


class CDEComplianceChecker:
    def __init__(self, dataset):
        self.dataset = dataset
        self.logger = dataset.logger
        self.failure_reason_code = ""

    def failed_error(self, msg, failure_reason_code):
        self.logger.error("Skipping dataset:" + msg)
        self.failure_reason_code = failure_reason_code

    def check_required_variables(self):
        # Depth/altitude defaults to 0 when absent.
        # https://coastwatch.pfeg.noaa.gov/erddap/download/setupDatasetsXml.html#LLAT
        # Static grids (no time axis) are valid metadata-only datasets.
        if self.dataset.cdm_data_type == "Grid":
            required_variables = ["latitude", "longitude"]
        else:
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
        standard_names_in_dataset = (
            self.dataset.df_variables.query("standard_name != ''")["standard_name"]
            .unique()
            .tolist()
        )

        # ioos_qc flag variables carry "<variable>_<test>_test" names by design.
        non_standard_names = [
            x for x in standard_names_in_dataset
            if not is_cf_standard_name(x) and not x.endswith("_test")
        ]
        if non_standard_names:
            self.dataset.warnings.add(
                NON_CF_STANDARD_NAMES,
                f"{len(non_standard_names)} standard_name(s) not in the CF "
                "standard name table",
                items=non_standard_names,
                count=len(non_standard_names),
            )

        supported_variables = intersection(
            supported_standard_names,
            [eov_standard_name(x) for x in standard_names_in_dataset],
        )
        if not supported_variables:
            self.failed_error("No supported variables found", NO_SUPPORTED_VARIABLES)
            return False
        return True

    def cde_ingest_flag(self):
        """ERDDAP admins opt a dataset out of CDE with the global cde_ingest=False."""
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
