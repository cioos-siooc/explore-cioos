#!/usr/bin/env python3

import urllib
from erddap_scraper.ERDDAP import ERDDAP
import pandas as pd
from urllib.parse import urlparse

import traceback
   

# TIMEOUT = 30


def erddap_csv_to_df(url):
    print(url)
    try:
        return pd.read_csv(url, skiprows=[1])
    # except urllib.error.HTTPError as e:
    #     print(url)
    #     print(e)
    #     # print(e.code, e.msg, e.errno, e.message)
    # except requests.exceptions.ConnectionError:
    #     print(url)
    #     print(e)
    #     # raise e
    except Exception:
        print(url)
        traceback.print_exc()



# Get max/min values for each of certain variables, in each profile
# usually time,lat,long,depth
def max_min_url(erddap_url, dataset_id, two_vars, max_min):
    # quote only needed for old erddap instances (ONC)
    url = f"{erddap_url}/tabledap/{dataset_id}.csv?{two_vars}" + urllib.parse.quote(
        f'&orderBy{max_min}("{two_vars}")'
    )
    # the second row in the CSV are units
    # url = urllib.parse.quote(url)
    # print(url)
    res = erddap_csv_to_df(url)

    return res


def get_profile_ids(erddap_url, dataset_id, profile_variable):
    if not profile_variable:
        return None
    url = f"{erddap_url}/tabledap/{dataset_id}.csv?{profile_variable}&distinct()"
    profile_ids = erddap_csv_to_df(url)
    return profile_ids


def get_max_min_stats(
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
    profile_count = 0

    if profile_ids is not None:
        profile_count = profile_ids.size

    data = pd.DataFrame()
    for field in fields:
        two_vars = ",".join([x for x in [profile_variable, field] if x])

        if profile_count == 1 and "actual_range" in metadata[field]:
            profile_id = profile_ids.iloc[0][profile_variable]
            print("Using actual_range")
            [min, max] = metadata[field]["actual_range"].split(",")
            profile_min = pd.DataFrame({profile_variable: [profile_id], field: [min]})
            profile_max = pd.DataFrame({profile_variable: [profile_id], field: [max]})
        else:
            profile_min = max_min_url(erddap_url, dataset_id, two_vars, "Min")
            profile_max = max_min_url(erddap_url, dataset_id, two_vars, "Max")

        if not profile_variable:
            # Probably a Point or Other. Treat it as a single profile
            profile_min[profile_variable] = dataset_id
            profile_max[profile_variable] = dataset_id

        profile_max.set_index(profile_variable, inplace=True)
        profile_min.set_index(profile_variable, inplace=True)

        # join this field's max and min
        field_max_min = profile_min.join(
            profile_max, how="left", lsuffix="_min", rsuffix="_max"
        )
        # thread_log(field_max_min)
        if data.empty:
            data = field_max_min
        else:
            # join the different max/min fields within the dataset
            data = data.join(field_max_min)
    return data


def safe_list_get(l, idx, default):
    try:
        return l[idx]
    except IndexError:
        return default


def scrape_erddap(erddap_url, result):
    # """ """

    domain = urlparse(erddap_url).netloc

    def thread_log(*kw):
        print(domain + ": ", *kw)

    datasets_not_pulled = []
    profile_data = pd.DataFrame()
    dataset_metadata_all = pd.DataFrame()

    erddap = ERDDAP(erddap_url)

    thread_log("Quering ERDDAP server", erddap_url)

    datasets = erddap.get_dataset_ids()

    # num_datasets = str(len(datasets))

    if not datasets:
        raise RuntimeError("No datasets found")
    # loop through each dataset to be processed
    for dataset_id in datasets:

        thread_log("Querying dataset:", dataset_id)

        dataset_variables = {}
        try:
            # thread_log("getting metadata")
            dataset_metadata = erddap.get_metadata_for_dataset(dataset_id)
            
            # print(metadata)
            dataset_globals = dataset_metadata["globals"]
            dataset_variables= dataset_metadata["variables"]

            standard_names_in_dataset = ",".join(
                [
                    x["standard_name"]
                    for x in dataset_variables.values()
                    if x.get("standard_name")
                ]
            )

            cdm_data_type = dataset_globals["cdm_data_type"]

            dataset_table_record = pd.DataFrame(
                {
                    "erddap_url": [erddap_url],
                    "dataset_id": [dataset_id],
                    "cdm_data_type": [cdm_data_type],
                    "dataset_standard_names": [standard_names_in_dataset],
                }
            )

            dataset_metadata_all = dataset_metadata_all.append(dataset_table_record)

            if cdm_data_type == "Trajectory":
                # TODO handle this
                # Get all distinct lat/longs
                # Otherwise get min/max values for time,depth
                thread_log("Skipping")
                continue

            # Use actual range if its set

            if cdm_data_type == "Other":
                # TODO handle this
                thread_log("Skipping")
                continue
            # thread_log(cdm_data_type)

            # Get the profile variable for each dataset
            cdm_mapping = {
                "TimeSeries": "cdm_timeseries_variables",
                "Profile": "cdm_profile_variables",
                # "Trajectory": "cdm_trajectory_variables",
                "TimeSeriesProfile": "cdm_timeseries_variables"  # not cdm_profile_variables
                # "Point":"cdm_profile_variables",
            }
            profile_variable = None

            if cdm_data_type in cdm_mapping:
                profile_variable = safe_list_get(
                    dataset_globals[cdm_mapping[cdm_data_type]].split(","), 0, ""
                )
            # these are the variables we are pulling max/min values for   
            important_vars = [
                "latitude",
                "longitude",
                "depth",
                "time",
            ]
            important_vars_in_dataset = [x for x in important_vars if x in dataset_variables]
            # thread_log(dataset_id, cdm_data_type, important_vars_in_dataset)

            # thread_log("getting profiles")
            profile_table_record = get_max_min_stats(
                erddap_url,
                profile_variable,
                dataset_id,
                important_vars_in_dataset,
                cdm_data_type,
                dataset_variables,
            )

            # profile_stats["cdm_data_type"] = cdm_data_type
            profile_table_record["dataset_id"] = dataset_id

            profile_data = profile_data.append(profile_table_record.reset_index(drop=True))

            # This df should look like:
            # profile_id min_time, max_time, min_lat,max_lat,min_depth,max_depth

        except Exception as r:
            thread_log("HTTP ERROR?")
            datasets_not_pulled.append([erddap_url, dataset_id])

            # except urllib.err http.client.RemoteDisconnected:
            # if r.status_code == 500:
            #     continue
            # there probably was no lat/long at this location

            traceback.print_exc()

    profile_data["server"] = domain

    column_order = [
        "server",
        "dataset_id",
        "cdm_data_type",
        "time_min",
        "time_max",
        "latitude_min",
        "latitude_max",
        "longitude_min",
        "longitude_max",
        "depth_min",
        "depth_max",
    ]

    reordered = [x for x in column_order if (x in profile_data)]
    profile_data = profile_data[reordered]

    # logger.info(record_count)
    thread_log("datasets_not_pulled", datasets_not_pulled)

    # using 'result' to return data from each thread
    result.append([profile_data, dataset_metadata_all])
