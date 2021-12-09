import json
import os


class CEDAComplianceChecker(object):
    def __init__(self, dataset):
        self.dataset = dataset
        self.logger = dataset.erddap_server.logger

    def check_required_variables(self):
        # make sure LLAT variables exist. Depth/Altitude is assumed to be 0 if it doesnt exist
        # https://coastwatch.pfeg.noaa.gov/erddap/download/setupDatasetsXml.html#LLAT
        required_variables = ["time", "latitude", "longitude"]

        missing_required_vars = [
            x for x in required_variables if x not in self.dataset.variables_list
        ]

        if missing_required_vars:
            self.logger.info(f"Can't find required variable: {missing_required_vars}")
            return False
        return True

    def check_supported_cf_name(self):
        supported_variables = intersection(
            supported_standard_names,
            self.dataset.df_variables["standard_name"].to_list(),
        )
        if not supported_variables:
            self.logger.info("No supported variables found")
            return False
        return True

    def check_supported_cdm_data_type(self):
        # Get the profile variable for each dataset
        cdm_data_types_supported = [
            "Point",
            "TimeSeries",
            "Profile",
            # "Trajectory",
            # "TrajectoryProfile",
            "TimeSeriesProfile",
        ]

        if self.dataset.cdm_data_type not in cdm_data_types_supported:
            self.logger.info(
                f"cdm_data_type {self.dataset.cdm_data_type} is not in {cdm_data_types_supported}"
            )
            return False
        return True

    def check_only_one_depth(self):
        if (
            "depth" in self.dataset.variables_list
            and "altitude" in self.dataset.variables_list
        ):
            self.logger.error("Found both depth and altitude")
            return False
        return True

    def passes_all_checks(self):
        return (
            self.check_required_variables()
            and self.check_supported_cf_name()
            and self.check_supported_cdm_data_type()
            and self.check_only_one_depth()
        )


def get_supported_standard_names():
    dir = os.path.dirname(os.path.realpath(__file__))

    with open(dir + "/eovs_to_standard_name.json") as f:
        d = json.loads(f.read()).values()
        standard_names = [j for sub in d for j in sub]
        return standard_names


supported_standard_names = get_supported_standard_names()


def intersection(lst1, lst2):
    """
    intersection doesnt include nulls
    """
    lst3 = [value for value in lst1 if value in lst2 and value != ""]
    return lst3
