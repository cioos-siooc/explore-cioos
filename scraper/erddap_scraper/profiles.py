#!/usr/bin/env python3

import pandas as pd

from erddap_scraper.ERDDAP import ERDDAP

dtypes = {
    "erddap_url": str,
    "dataset_id": str,
    # "timeseries_profile_id": str,
    "timeseries_id": str,
    "profile_id": str,
    "longitude_min": float,
    "longitude_max": float,
    "latitude_min": float,
    "latitude_max": float,
}

# ,timeseries_id,latitude_min,latitude_max,longitude_min,longitude_max,time_min,time_max,n_records,dataset_id,erddap_url,depth_min,depth_max
def get_profiles(dataset):
    """
    Get max/min stats for each profile in a dataset

    if there's only a single profile, use actual_range when possible

    For ONC we can't get max min values for profiles but we can get it for the entire dataset. This works because
    they only use one profile per dataset

    llat_variables_in_dataset is any of latitude/longitude/time/depth variables that exist in this dataset

    Example of profile_variable is: {'profile_id': 'hakai_id', 'timeseries_id': 'station'}


    """
    df_variables = dataset.df_variables

    llat_variables = [
        "latitude",
        "longitude",
        "depth",
        "altitude",
        "time",
    ]
    llat_variables_in_dataset = [
        x for x in llat_variables if x in dataset.variables_list
    ]
    profile_variable_list = []

    # Organize dataset variables by their cf_roles
    # eg profile_variable={'profile_id': 'hakai_id', 'timeseries_id': 'station'}
    profile_variables = (
        df_variables.set_index("cf_role", drop=False)
        .query('cf_role != ""')[["cf_role", "name"]]["name"]
        .to_dict()
    )
    # Profile Variable List - list of dataset variables that have cf_roles attached to them
    profile_variable_list = list(profile_variables.values())

    # sorting so the url is consistent every time for query caching
    profile_variable_list.sort()

    # number of profiles in this dataset (eg by counting unique profile_id)

    # profiles=pd.DataFrame(columns=profile_columns.keys())
    profiles = dataset.get_profile_ids(",".join(profile_variable_list))

    # print(profiles)
    if profiles.empty:
        return profiles
    logger = dataset.logger
    logger.debug(f"Found {len(profiles)} profiles")

    # If TimeSeriesProfiles review how many profiles per timeseries exist
    if dataset.cdm_data_type == "TimeSeriesProfile":
        # Review if there's a enough samples to group by timeseries only
        profiles_per_timeseries = profiles.groupby(
            profile_variables["timeseries_id"]
        ).agg("count")[profile_variables["profile_id"]]

        if (profiles_per_timeseries > 2000).any():
            # If too many profiles per timeseries just group by timeseries_id
            profile_variables.pop("profile_id")
            profile_variable_list = list(profile_variables.values())
            profiles = profiles_per_timeseries.to_frame(name="n_profiles").reset_index()

    if "profile_id" in profile_variables:
        # if subseted by profile_id there's only one per profile
        profiles["n_profiles"] = 1

    # Start profiles table
    profiles = profiles.set_index(profile_variable_list)

    for llat_variable in llat_variables_in_dataset:
        if llat_variable in profile_variable_list:
            # If this variable is already use to distinqguish individual profiles just copy their values
            profiles[llat_variable + "_min"] = profiles.index.get_level_values(
                llat_variable
            )
            profiles[llat_variable + "_max"] = profiles.index.get_level_values(
                llat_variable
            )
            continue
        # if this dataset is a single profile and actual_range is set, use that
        elif len(profiles) == 1 and df_variables.loc[llat_variable].get("actual_range"):
            # if this dataset is a single profile and actual_range is set, use that
            logger.debug(f"Using dataset actual_range for {llat_variable}")

            [min, max] = df_variables.loc[llat_variable]["actual_range"].split(",")
            profiles[llat_variable + "_min"] = min
            profiles[llat_variable + "_max"] = max
            continue
        else:
            variables = profile_variable_list + [llat_variable]

            # Get the min max values from erddap
            profile_min = dataset.get_max_min(variables, "Min")
            profile_max = dataset.get_max_min(variables, "Max")

            # Something went wrong
            if profile_min.empty or profile_max.empty:
                logger.error(f"No data found for  {dataset.id}")
                # return empty df
                return pd.DataFrame()

        # setting same index so they can be joined more easily
        profile_max.set_index(profile_variable_list, inplace=True)
        profile_min.set_index(profile_variable_list, inplace=True)

        # join this field's max and min
        field_max_min = profile_min.join(
            profile_max,
            how="left",
            lsuffix="_min",
            rsuffix="_max",
        )

        # join the different max/min fields within the dataset
        profiles = profiles.join(field_max_min)

    # Get Count for each dataset
    # First identify variables to use
    logger.debug("Get record Count")
    count_variables = profile_variable_list.copy()

    if "time" not in count_variables:
        count_variables.append("time")
    if (
        dataset.cdm_data_type == "TimeSeriesProfile"
        and "depth" in dataset.variables_list
        and "depth" not in count_variables
    ):
        count_variables.append("depth")

    # If time and depth are used as cf_roles grab the last variable
    if count_variables == profile_variable_list:
        count_variables.append(dataset.variables_list)[-1]

    # Retrieve Count value per profile
    time_min = ERDDAP.parse_erddap_date(profiles["time_min"].min())
    time_max = ERDDAP.parse_erddap_date(profiles["time_max"].max())

    count_variables = list(set(count_variables))
    count_variables.sort()

    profile_count = dataset.get_count(
        count_variables, profile_variable_list, time_min, time_max
    )

    if not profile_count.empty:
        profiles["n_records"] = profile_count.set_index(profile_variable_list).max(
            axis="columns"
        )
    if not "n_records" in profiles:
        profiles["n_records"] = None

    # Rename cf_role variables as cf_role and drop from index.
    # Eg rename 'station_id' to 'timeseries_id'
    profiles.reset_index(drop=False, inplace=True)

    profiles.rename(
        columns={value: key for key, value in profile_variables.items()}, inplace=True
    )

    # Convert time variables and add dataset_id
    profiles["time_min"] = ERDDAP.parse_erddap_dates(profiles["time_min"])
    profiles["time_max"] = ERDDAP.parse_erddap_dates(profiles["time_max"])
    profiles["dataset_id"] = dataset.id
    profiles["erddap_url"] = dataset.erddap_server.url

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
    # profiles[["a", "b"]] = df[["a", "b"]].apply(pd.to_numeric)
    # profiles = profiles.fillna("")

    # if depth isnt a variable, set it to 0
    if "depth_min" not in profiles:
        profiles["depth_min"] = 0
        profiles["depth_max"] = 0

    # profiles["depth_max"]=profiles["depth_max"].astype()

    profiles["depth_min"].fillna(0, inplace=True)
    profiles["depth_max"].fillna(0, inplace=True)

    if not "profile_id" in profiles:
        profiles["profile_id"] = ""
    if not "timeseries_id" in profiles:
        profiles["timeseries_id"] = ""

    cols_to_convert = ["latitude_min", "latitude_max", "longitude_min", "longitude_max"]
    profiles[cols_to_convert] = profiles[cols_to_convert].apply(
        pd.to_numeric, errors="coerce"
    )

    profiles = profiles.astype(dtypes)
    profiles = profiles.round(4)

    profiles_bad_geom_query = "((latitude_min <= -90) or (latitude_max >= 90) or (longitude_min <= -180) or (longitude_max >= 180))"
    profiles_bad_geom = profiles.query(profiles_bad_geom_query)

    if not profiles_bad_geom.empty:
        logger.warn("These profiles with bad lat/long values will be removed:")
        print(profiles_bad_geom.to_csv(None))
        profiles = profiles.query("not " + profiles_bad_geom_query)
    # print(profiles.depth_min.replace('',0)]])
    return profiles
