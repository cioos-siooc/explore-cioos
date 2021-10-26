#!/usr/bin/env python3

import traceback
from urllib.error import HTTPError
from urllib.parse import urlparse

import pandas as pd

from erddap_scraper.ERDDAP import ERDDAP
from erddap_scraper.profiles import get_profiles

# TIMEOUT = 30


def scrape_erddap(erddap_url, result, dataset_ids=None):
    # """ """
    erddap_url = erddap_url.rstrip("/")
    domain = urlparse(erddap_url).netloc

    def thread_log(*kw):
        print(domain + ": ", *kw)

    datasets_not_added = []
    column_order = [
        "erddap_url",
        "dataset_id",
        "profile_id",
        "time_min",
        "time_max",
        "latitude_min",
        "latitude_max",
        "longitude_min",
        "longitude_max",
        "depth_min",
        "depth_max",
        "n_records",
        "n_profiles",
    ]

    df_profiles_all = pd.DataFrame(columns=column_order)

    df_datasets_all = pd.DataFrame()

    erddap = ERDDAP(erddap_url)

    thread_log("Quering ERDDAP server", erddap_url)

    datasets = erddap.get_dataset_ids()

    if not datasets:
        raise RuntimeError("No datasets found")
    # loop through each dataset to be processed

    for i, dataset_id in enumerate(datasets):

        if dataset_ids and dataset_id not in dataset_ids:
            continue

        thread_log("Querying dataset:", dataset_id, f"{i+1}/{len(datasets)}")

        dataset_variables = {}
        dataset_was_added = False
        try:
            # thread_log("getting metadata")
            dataset_metadata = erddap.get_metadata_for_dataset(dataset_id)

            # print(metadata)
            dataset_globals = dataset_metadata["globals"]
            dataset_variables = dataset_metadata["variables"]

            cdm_data_type = dataset_globals["cdm_data_type"]

            df_dataset = pd.DataFrame(
                {
                    "erddap_url": [erddap_url],
                    "dataset_id": [dataset_id],
                    "cdm_data_type": [cdm_data_type],
                }
            )

            if cdm_data_type == "Trajectory":
                # TODO handle this
                # Get all distinct lat/longs
                # Otherwise get min/max values for time,depth
                thread_log("Skipping cdm_data_type",cdm_data_type)
                continue

            # Use actual range if its set

            if cdm_data_type == "Other":
                # TODO handle this
                thread_log("Skipping cdm_data_type",cdm_data_type)
                continue

            # Get the profile variable for each dataset
            cdm_mapping = {
                "TimeSeries": "timeseries_id",
                "Profile": "profile_id",
                # "Trajectory": "cdm_trajectory_variables",
                "TimeSeriesProfile": "profile_id"  # not cdm_profile_variables
                # "Point":"cdm_profile_variables",
            }
            profile_variable = {}

            # Find out which variable has cf_role=timeseries_id or profile_id
            if cdm_data_type in cdm_mapping:
                for variable in dataset_variables:
                    if "cf_role" in dataset_variables[variable]:
                        profile_variable[
                            dataset_variables[variable]["cf_role"]
                        ] = variable

            # these are the variables we are pulling max/min values for
            important_vars = [
                "latitude",
                "longitude",
                "depth",
                "time",
            ]
            important_vars_in_dataset = [
                x for x in important_vars if x in dataset_variables
            ]

            df_profiles = get_profiles(
                erddap_url,
                profile_variable,
                dataset_id,
                important_vars_in_dataset,
                dataset_variables,
            )

            # only write dataset/profile if there are some profiles
            if df_profiles is not None:
                df_profiles_all = df_profiles_all.append(df_profiles)
                df_datasets_all = df_datasets_all.append(df_dataset)
                dataset_was_added = not df_dataset.empty and not df_profiles.empty

        except HTTPError as e:

            thread_log("HTTP ERROR", e.code, erddap_url)
            if e.code != 404:
                traceback.print_exc()

        except Exception as e:
            traceback.print_exc()

        if not dataset_was_added:
            datasets_not_added.append(erddap_url + "/tabledap/" + dataset_id + ".html")

    df_profiles_all["erddap_url"] = erddap_url

    reordered = [x for x in column_order if (x in df_profiles_all)]
    df_profiles_all = df_profiles_all[reordered]

    # logger.info(record_count)
    thread_log("datasets_not_added", datasets_not_added)

    # using 'result' to return data from each thread
    result.append([df_profiles_all, df_datasets_all, datasets_not_added])
