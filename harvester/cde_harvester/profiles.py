#!/usr/bin/env python3

from datetime import datetime

import pandas as pd
from cde_harvester.ERDDAP import ERDDAP


def get_profiles(dataset):
    """
    Get max/min stats for each profile in a dataset

    if there's only a single profile, use actual_range when possible

    For ONC we can't get max min values for profiles but we can get it for the entire dataset. This works because
    they only use one profile per dataset

    llat_variables_in_dataset is any of time, depth variables that exist in this dataset

    Example of profile_variable is: {'profile_id': 'hakai_id', 'timeseries_id': 'station'}


    """

    df_variables = dataset.df_variables

    vertical_variables = ["depth", "altitude"]

    # lat,lon not in this list. They have to be treated differently as getting the min of the lat and lon could create a point not in the dataset
    llat_variables = [
        "depth",
        "altitude",
        "time",
    ]
    llat_variables_in_dataset = [
        x for x in llat_variables if x in dataset.variables_list
    ]

    profiles_with_lat_lon = dataset.get_profile_ids()

    if profiles_with_lat_lon.empty:
        return profiles_with_lat_lon

    profiles = profiles_with_lat_lon[
        profiles_with_lat_lon.columns.difference(["latitude", "longitude"])
    ].drop_duplicates()
    # Organize dataset variables by their cf_roles
    # eg profile_variable={'profile_id': 'hakai_id', 'timeseries_id': 'station'}
    profile_variables = dataset.profile_variables

    # Profile Variable List - list of dataset variables that have cf_roles attached to them
    profile_variable_list = dataset.profile_variable_list

    if profiles.empty:
        return profiles
    logger = dataset.logger
    logger.debug(f"Found {len(profiles)} profiles")

    # If TimeSeriesProfiles review how many profiles per timeseries exist
    if dataset.cdm_data_type == "TimeSeriesProfile":
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

    if "profile_id" in profile_variables:
        # if subseted by profile_id there's only one per profile
        profiles_with_lat_lon["n_profiles"] = 1

    # Start profiles table
    profiles_with_lat_lon = profiles_with_lat_lon.set_index(profile_variable_list)

    for llat_variable in llat_variables_in_dataset:
        # lat,lon have been removed. They are treated differently as it doesn't work to treat lat and lon separately
        if llat_variable in profile_variable_list:
            # If this variable is already use to distinqguish individual profiles just copy their values
            val = profiles_with_lat_lon.index.get_level_values(llat_variable)
            profiles_with_lat_lon[llat_variable + "_min"] = val
            profiles_with_lat_lon[llat_variable + "_max"] = val
            continue
        # if this dataset is a single profile and actual_range is set, use that
        elif len(profiles) == 1 and df_variables.loc[llat_variable].get("actual_range"):
            # if this dataset is a single profile and actual_range is set, use that
            logger.debug(f"Using dataset actual_range for {llat_variable}")

            [min, max] = df_variables.loc[llat_variable]["actual_range"].split(",")

            # For ongoing datasets
            if "NaN" in max:
                max = datetime.utcnow().isoformat()

            if llat_variable in vertical_variables:
                min=float(min)
                max=float(max)

            profiles_with_lat_lon[llat_variable + "_min"] = min
            profiles_with_lat_lon[llat_variable + "_max"] = max
            continue
        else:
            variables = profile_variable_list + [llat_variable]
            profile_min_max = dataset.get_max_min(variables)

            # Something went wrong
            if profile_min_max.empty:
                logger.error(f"No data found for  {dataset.id}")
                return profile_min_max

        profiles_with_lat_lon = profiles_with_lat_lon.join(profile_min_max)

    profiles = profiles_with_lat_lon

    # Get Count for each dataset
    # First identify variables to use
    logger.debug("Get record Count")
    count_variables = profile_variable_list.copy()

    count_variables.append("time")

    if "depth" in dataset.variables_list:
        count_variables.append("depth")

    # Retrieve Count value per profile
    profiles = profiles.query(
        "(not time_min.isnull()) and not (time_max.isnull())"
    ).copy()

    time_min = ERDDAP.parse_erddap_date(profiles["time_min"].min())
    time_max = ERDDAP.parse_erddap_date(profiles["time_max"].max())

    count_variables = sorted(list(set(count_variables)))

    profile_count = dataset.get_count(
        count_variables, profile_variable_list, time_min, time_max
    )
    if not profile_count.empty:
        profiles["n_records"] = profile_count.set_index(profile_variable_list).max(
            axis="columns"
        )
    if not "n_records" in profiles:
        profiles["n_records"] = None

    # something went wrong with counting records
    profiles = profiles.query("not n_records.isnull()")

    if profiles.empty:
        logger.error("Error counting records")
        return profiles

    profiles = profiles.reset_index(drop=False).copy()

    # Rename cf_role variables as cf_role and drop from index.
    # Eg rename 'station_id' to 'timeseries_id'
    # del profiles["STN_ID"]
    profiles.rename(
        columns={value: key for key, value in profile_variables.items()}, inplace=True
    )

    # Convert time variables and add dataset_id so the records can be linked to dataset in the DB
    profiles["time_min"] = ERDDAP.parse_erddap_dates(profiles["time_min"])
    profiles["time_max"] = ERDDAP.parse_erddap_dates(profiles["time_max"])
    profiles["dataset_id"] = dataset.id
    profiles["erddap_url"] = dataset.erddap_url

    # special case
    if "altitude" in dataset.variables_list:
        profiles["altitude_min"] = -profiles["altitude_min"]
        profiles["altitude_max"] = -profiles["altitude_max"]
        profiles = profiles.rename(
            {
                "depth_min": "altitude_min",
                "depth_max": "altitude_max",
            }
        )

    # if depth isnt a variable, set it to 0
    if "depth_min" not in profiles:
        profiles["depth_min"] = 0
        profiles["depth_max"] = 0

    profiles["depth_min"].fillna(0, inplace=True)
    profiles["depth_max"].fillna(0, inplace=True)

    if not "profile_id" in profiles:
        profiles["profile_id"] = ""

    if not "timeseries_id" in profiles:
        profiles["timeseries_id"] = ""

    cols_to_convert = ["latitude", "longitude"]

    profiles[cols_to_convert] = profiles[cols_to_convert].apply(
        pd.to_numeric, errors="coerce"
    )
    # calculate records_per_day
    days = (profiles["time_max"] - profiles["time_min"]).dt.days

    # if the start and end date is same day
    days = days.replace(0, 1)

    profiles["records_per_day"] = profiles["n_records"] / (days)

    profiles = profiles.round(4)

    profiles_bad_geom_query = f"""((latitude <= -90) or (latitude >= 90) or  \
                                (longitude <= -180) or (longitude >= 180) or  \
                                (depth_max > 15000) or (depth_min < -100)) or \
                                records_per_day.isnull()
                              """
    #    or \
    # time_min > '{datetime.now(pytz.utc)}' or \
    # time_max > '{datetime.now(pytz.utc)}')
    profiles_bad_geom = profiles.query(profiles_bad_geom_query)

    if not profiles_bad_geom.empty:
        logger.warn(
            "These profiles with bad lat/long/depth/time values will be removed:"
        )
        # TODO this could use record_id if it existed
        logger.warn(set(profiles_bad_geom["profile_id"].to_list()))
        logger.warn(set(profiles_bad_geom["timeseries_id"].to_list()))

        profiles = profiles.query("not " + profiles_bad_geom_query)

    return profiles
