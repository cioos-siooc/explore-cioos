#!/usr/bin/env python3

import pandas as pd
from urllib.error import HTTPError
import traceback
import urllib


def parse_erddap_dates(series):
    """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
    is_timestamp = str(series.tolist()[0]).strip().startswith("1.")

    if is_timestamp:
        return pd.to_datetime(series, unit="s")

    return pd.to_datetime(series, errors="coerce")


def erddap_csv_to_df(url):
    print(url)
    try:
        return pd.read_csv(url, skiprows=[1])

    except HTTPError as e:

        status_code = e.code
        print("HTTP ERROR", status_code, url, e.reason)
        if status_code != 404:
            traceback.print_exc()

        return None


# Get max/min values for each of certain variables, in each profile
# usually time,lat,long,depth
def max_min_url(erddap_url, dataset_id, two_vars, max_min):
    url = f"{erddap_url}/tabledap/{dataset_id}.csv?{two_vars}" + urllib.parse.quote(
        f'&orderBy{max_min}("{two_vars}")'
    )

    # url = f'{erddap_url}/tabledap/{dataset_id}.csv?{two_vars}&orderBy{max_min}("{two_vars}")'

    # the second row in the CSV are units
    res = erddap_csv_to_df(url)
    return res


def get_profile_ids(erddap_url, dataset_id, profile_variable):
    if not profile_variable:
        return []
    url = f"{erddap_url}/tabledap/{dataset_id}.csv?{profile_variable}&distinct()"
    profile_ids = erddap_csv_to_df(url)
    return list(filter(None, profile_ids[profile_variable]))


def get_profiles(
    erddap_url, profile_variable, dataset_id, fields, cdm_data_type, metadata
):
    """
    Get max/min stats for each profile in a dataset

    if there's only a single profile, use actual_range when possible

    For ONC we can't get max min values for profiles but we can get it for the entire dataset. This works because
    they only use one profile per dataset

    """

    # number of profiles in this dataset (eg by counting unique profile_id)
    profile_ids = get_profile_ids(erddap_url, dataset_id, profile_variable)

    profile_records = pd.DataFrame()
    for field in fields:
        print(field)
        two_vars = ",".join([x for x in [profile_variable, field] if x])

        # if this dataset is a single profile and actual_range is set, use that
        if len(profile_ids) == 1 and "actual_range" in metadata[field]:
            profile_id = profile_ids[0]
            # print("Using actual_range for", field)
            [min, max] = metadata[field]["actual_range"].split(",")
            profile_min = pd.DataFrame({profile_variable: [profile_id], field: [min]})
            profile_max = pd.DataFrame({profile_variable: [profile_id], field: [max]})
        else:
            profile_min = max_min_url(erddap_url, dataset_id, two_vars, "Min")
            profile_max = max_min_url(erddap_url, dataset_id, two_vars, "Max")

        # Something went wrong
        if profile_min is None or profile_max is None:
            print("No data found for ", dataset_id)
            return None

        if not profile_variable:
            # Probably a Point or Other. Treat it as a single profile
            profile_min[profile_variable] = dataset_id
            profile_max[profile_variable] = dataset_id

        # setting same index so they can be joined more easily
        profile_max.set_index(profile_variable, inplace=True)
        profile_min.set_index(profile_variable, inplace=True)

        # join this field's max and min
        field_max_min = profile_min.join(
            profile_max,
            how="left",
            lsuffix="_min",
            rsuffix="_max",
        )
        # thread_log(field_max_min)
        if profile_records.empty:
            profile_records = field_max_min
        else:
            # join the different max/min fields within the dataset
            profile_records = profile_records.join(field_max_min)

    profile_records.reset_index(drop=False, inplace=True)
    profile_records["time_min"] = parse_erddap_dates(profile_records["time_min"])
    profile_records["time_max"] = parse_erddap_dates(profile_records["time_max"])
    profile_records["profile_id"] = profile_records.get(profile_variable, dataset_id)
    profile_records["dataset_id"] = dataset_id

    return profile_records