"""Handler for cdm_data_type=TimeSeriesProfile (profiles at fixed stations)."""

from cde_harvester.dataset_types import tabledap_features
from cde_harvester.dataset_types.base import DatasetTypeHandler


class TimeSeriesProfileHandler(DatasetTypeHandler):
    features_span_multiple_days = True
    cdm_data_type = "TimeSeriesProfile"

    def extract_features(self, dataset):
        return tabledap_features.extract_features(dataset, self)

    def adjust_feature_identity(
        self, dataset, profiles_with_lat_lon, profiles, profile_variables,
        profile_variable_list,
    ):
        # Review if there's a enough samples to group by timeseries only
        profiles_per_timeseries = profiles_with_lat_lon.groupby(
            profile_variables["timeseries_id"]
        ).agg("count")[profile_variables["profile_id"]]

        if len(profiles_per_timeseries > 2000):
            # If too many profiles per timeseries just group by timeseries_id
            # In this case we will drop the profile ID column and remove the
            # duplicates this creates.

            dropping_column = profile_variables["profile_id"]

            profile_variables.pop("profile_id")
            profile_variable_list = list(profile_variables.values())

            profiles_with_lat_lon = profiles_with_lat_lon.drop(
                dropping_column, axis=1
            ).drop_duplicates()

            timeseries_id_with_count = profiles_per_timeseries.to_frame(
                name="n_profiles"
            )
            profiles_with_lat_lon.set_index(profile_variable_list, inplace=True)
            profiles_with_lat_lon = profiles_with_lat_lon.join(timeseries_id_with_count)
            profiles_with_lat_lon.reset_index(inplace=True)

        return profiles_with_lat_lon, profile_variables, profile_variable_list
