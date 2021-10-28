#!/usr/bin/env python3

from io import StringIO

import requests

import pandas as pd


def parse_erddap_dates(series):
    """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
    is_timestamp = str(series.tolist()[0]).strip().startswith("1.")

    if is_timestamp:
        return pd.to_datetime(series, unit="s")

    return pd.to_datetime(series, errors="coerce")


def erddap_csv_to_df(url):
    print(url)
    response = requests.get(url)
    if response.status_code == 404:
        return pd.DataFrame()
    elif (
        response.status_code == 500
        and "Query error: No operator found in constraint=&quot;orderByCount"
        in response.text
    ):
        print("OrderByCount not available within this ERDDAP Version")
        return pd.DataFrame()
    elif (
        response.status_code == 500
        and "You are requesting too much data." in response.text
    ):
        print("Query too big for the server")
        return pd.DataFrame()
    elif response.status_code != 200:
        # Report if not All OK
        response.raise_for_status()
        response.text
    else:
        return pd.read_csv(StringIO(response.text))


# Get max/min values for each of certain variables, in each profile
# usually time,lat,long,depth
def get_max_min(erddap_url, dataset_id, vars, max_min):
    url = (
        f"{erddap_url}/tabledap/{dataset_id}.csv?{','.join(vars)}"
        + requests.utils.quote(f'&orderBy{max_min}("{",".join(vars)}")')
    )
    return erddap_csv_to_df(url)


def get_profile_ids(erddap_url, dataset_id, profile_variable):
    if not profile_variable:
        return []
    url = f"{erddap_url}/tabledap/{dataset_id}.csv?{profile_variable}&distinct()"
    profile_ids = erddap_csv_to_df(url)

    if profile_ids.empty:
        return pd.DataFrame()

    return profile_ids


# Get count for each of certain variables, in each profile
def get_count(erddap_url, dataset_id, vars, groupby):
    url = (
        f"{erddap_url}/tabledap/{dataset_id}.csv?{','.join(vars)}"
        + requests.utils.quote(f'&orderByCount("{",".join(groupby)}")')
    )
    return erddap_csv_to_df(url)


def get_profiles(erddap_url, profile_variable, dataset_id, fields, metadata):
    """
    Get max/min stats for each profile in a dataset

    if there's only a single profile, use actual_range when possible

    For ONC we can't get max min values for profiles but we can get it for the entire dataset. This works because
    they only use one profile per dataset

    fields is any of lat/long/time/depth variables, if they exist in this dataset

    """
    # Profile Variable List
    cf_roles = ["trajectory_id", "timeseries_id", "profile_id"]
    profile_variable_list = []
    for cf_role in cf_roles:
        if cf_role in profile_variable:
            profile_variable_list += [profile_variable[cf_role]]

    # number of profiles in this dataset (eg by counting unique profile_id)
    profile_records = get_profile_ids(
        erddap_url, dataset_id, ",".join(profile_variable_list)
    )

    if len(profile_records) == 0:
        return None
    print("Found", len(profile_records), "profiles")

    # If TimeSeriesProfiles review how many profiles per timeseries exist
    if "timeseries_id" in profile_variable and "profile_id" in profile_variable:
        # Review if there's a enough samples to group by timeseries only
        profiles_per_timeseries = profile_records.groupby(
            profile_variable["timeseries_id"]
        ).agg("count")[profile_variable["profile_id"]]
        if (profiles_per_timeseries > 2000).any():
            # If too many profiles per timeseries just group by timeseries_id
            profile_variable.pop("profile_id")
            profile_variable_list = profile_variable_list[:-1]
            profile_records = profiles_per_timeseries.to_frame(
                name="n_profiles"
            ).reset_index()

    if "profile_id" in profile_variable:
        # if subseted by profile_id there's only one per profile
        profile_records["n_profiles"] = 1

    # Start profile_records table
    profile_records = profile_records.set_index(profile_variable_list)

    for field in fields:
        print(field)
        variables = profile_variable_list.copy()
        variables.append(field)
        if field in profile_records.index.names:
            # If this variable is already use to distinqguish individual profiles just copy their values
            profile_records[field + "_min"] = profile_records.index.get_level_values(
                field
            )
            profile_records[field + "_max"] = profile_records.index.get_level_values(
                field
            )
            continue
        # if this dataset is a single profile and actual_range is set, use that
        elif len(profile_records) == 1 and "actual_range" in metadata[field]:
            # if this dataset is a single profile and actual_range is set, use that
            print("Using dataset actual_range for", field)
            [min, max] = metadata[field]["actual_range"].split(",")
            profile_records[field + "_min"] = min
            profile_records[field + "_max"] = max
            continue
        else:
            # Get the min max values from erddap
            profile_min = get_max_min(erddap_url, dataset_id, variables, "Min")
            profile_max = get_max_min(erddap_url, dataset_id, variables, "Max")

        # Something went wrong
        if len(profile_min) == 0 or len(profile_max) == 0:
            print("No data found for ", dataset_id)
            return None

        if not profile_variable:
            # Probably a Point or Other. Treat it as a single profile
            profile_min[profile_variable] = dataset_id
            profile_max[profile_variable] = dataset_id

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
        profile_records = profile_records.join(field_max_min)

    # Get Count for each dataset
    print("Get record Count")
    count_variables = profile_variable_list.copy()
    if "time" not in count_variables:
        count_variables.append("time")
    if (
        "timeseries_id" in profile_variable
        and "profile_id" in profile_variable
        and "depth" in metadata
        and "depth" not in count_variables
    ):
        count_variables.append("depth")
    # If time and depth are used as cf_roles grab the last variable
    if count_variables == profile_variable_list:
        count_variables.append(list(metadata.keys())[-1])
    profile_count = get_count(
        erddap_url, dataset_id, set(count_variables), profile_variable_list
    )
    profile_records["n_records"] = profile_count.set_index(profile_variable_list).max(
        axis="columns"
    )

    # Generate profile_id variable from indexed variables
    profile_records.index = profile_records.index.to_flat_index().rename("profile_id")
    profile_records.reset_index(drop=False, inplace=True)

    # Convert time variables and add dataset_id
    profile_records["time_min"] = parse_erddap_dates(profile_records["time_min"])
    profile_records["time_max"] = parse_erddap_dates(profile_records["time_max"])
    profile_records["dataset_id"] = dataset_id

    return profile_records
