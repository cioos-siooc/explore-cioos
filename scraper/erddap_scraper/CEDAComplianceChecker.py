from erddap_scraper.utils import eov_to_standard_names, flatten, intersection


class CEDAComplianceChecker(object):
    def __init__(self, dataset):
        self.dataset = dataset
        self.logger = dataset.logger

    def failed_error(self, msg):
        self.logger.error("Skipping dataset:" + msg)

    def check_required_variables(self):
        # make sure LLAT variables exist. Depth/Altitude is assumed to be 0 if it doesnt exist
        # https://coastwatch.pfeg.noaa.gov/erddap/download/setupDatasetsXml.html#LLAT
        required_variables = ["time", "latitude", "longitude"]

        missing_required_vars = [
            x for x in required_variables if x not in self.dataset.variables_list
        ]

        if missing_required_vars:
            self.failed_error(f"Can't find required variable: {missing_required_vars}")
            return False
        return True

    def check_supported_cf_name(self):
        supported_standard_names = flatten(list(eov_to_standard_names.values()))
        standard_names_in_dataset = self.dataset.df_variables["standard_name"].to_list()

        supported_variables = intersection(
            supported_standard_names,
            standard_names_in_dataset,
        )
        if not supported_variables:
            self.failed_error("No supported variables found")
            return False
        return True

    def check_only_one_depth(self):
        if (
            "depth" in self.dataset.variables_list
            and "altitude" in self.dataset.variables_list
        ):
            self.failed_error("Found both depth and altitude")
            return False
        return True

    def passes_all_checks(self):
        return (
            self.check_required_variables()
            and self.check_supported_cf_name()
            and self.check_only_one_depth()
        )
