"""Handler for cdm_data_type=TimeSeriesProfile (profiles at fixed stations)."""

import pandas as pd
from requests.exceptions import HTTPError

from cde_harvester.dataset_types import tabledap_features
from cde_harvester.dataset_types.base import DatasetTypeHandler
from cde_harvester.sources.erddap.client import ERDDAP, ResponseTooLargeError


class TimeSeriesProfileHandler(DatasetTypeHandler):
    features_span_multiple_days = True
    cdm_data_type = "TimeSeriesProfile"
    # A profile per timestamp always exceeds the 2000-per-timeseries collapse
    # threshold below.
    collapse_time_profile_ids = True

    def extract_features(self, dataset):
        return tabledap_features.extract_features(dataset, self)

    def adjust_feature_identity(
        self, dataset, profiles_with_lat_lon, profiles, profile_variables,
        profile_variable_list,
    ):
        if "profile_id" not in profile_variables:
            return profiles_with_lat_lon, profile_variables, profile_variable_list

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

            profiles_with_lat_lon = profiles_with_lat_lon.drop(dropping_column, axis=1)
            time_bounds = {
                column: how
                for column, how in (("time_min", "min"), ("time_max", "max"))
                if column in profiles_with_lat_lon
            }
            if time_bounds:
                # Time bounds came with the identity: a timeseries spans the
                # envelope of its profiles. ERDDAP's ISO strings sort as dates.
                profiles_with_lat_lon = (
                    profiles_with_lat_lon.groupby(profile_variable_list, dropna=False)
                    .agg(time_bounds)
                    .reset_index()
                )
            else:
                profiles_with_lat_lon = profiles_with_lat_lon.drop_duplicates()

            timeseries_id_with_count = profiles_per_timeseries.to_frame(
                name="n_profiles"
            )
            profiles_with_lat_lon.set_index(profile_variable_list, inplace=True)
            profiles_with_lat_lon = profiles_with_lat_lon.join(timeseries_id_with_count)
            profiles_with_lat_lon.reset_index(inplace=True)

        return profiles_with_lat_lon, profile_variables, profile_variable_list

    def rows_per_timestep(self, dataset, profiles, profile_variable_list):
        """Rows in one profile per feature, sampled at the earliest timestep.

        One small time-constrained request: ERDDAP reads only the files that
        hold that instant. A feature absent from the sample takes the mean of
        those present; a failed sample counts one row per timestep.
        """
        start = ERDDAP.parse_erddap_dates(profiles["time_min"].astype(str).str.strip())
        first = str(profiles["time_min"].iloc[start.argmin()]).strip()
        try:
            sample = dataset.dataset_tabledap_query(
                ",".join(profile_variable_list + ["time"]) + f"&time={first}"
            )
        except (HTTPError, ResponseTooLargeError):
            sample = pd.DataFrame()

        rows = pd.Series(dtype=float)
        if not sample.empty:
            rows = (
                sample.astype(dict.fromkeys(profile_variable_list, str))
                .groupby(profile_variable_list)
                .size()
                .reindex(tabledap_features._string_key(profiles.index))
            )
        if rows.isna().all():
            dataset.logger.warning(
                "Could not sample rows per profile; counting one per timestep"
            )
            return 1
        return pd.Series(rows.fillna(rows.mean()).to_numpy(), index=profiles.index)
