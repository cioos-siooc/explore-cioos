#!/usr/bin/env python3

import traceback

import pandas as pd
from erddap_scraper.CEDAComplianceChecker import CEDAComplianceChecker
from erddap_scraper.ERDDAP import ERDDAP
from erddap_scraper.profiles import get_profiles
from requests.exceptions import HTTPError

# TIMEOUT = 30


def scrape_erddap(erddap_url, result, limit_dataset_ids=None, cache_requests=False):
    # """ """
    datasets_not_added = []

    df_profiles_all = pd.DataFrame()

    df_datasets_all = pd.DataFrame(
        columns=["erddap_url", "dataset_id", "cdm_data_type"]
    )
    df_variables_all = pd.DataFrame(
        columns=[
            "name",
            "type",
            "cf_role",
            "standard_name",
            "erddap_url",
            "dataset_id",
        ]
    )

    erddap = ERDDAP(erddap_url, cache_requests)
    logger = erddap.get_logger()
    df_all_datasets = erddap.df_all_datasets

    cdm_data_types_supported = [
        # "Point",
        "TimeSeries",
        "Profile",
        "TimeSeriesProfile",
        # "Trajectory",
        # "TrajectoryProfile",
    ]
    if limit_dataset_ids:
        df_all_datasets = df_all_datasets.query("datasetID in @limit_dataset_ids")

    cdm_data_type_test = "cdm_data_type in @cdm_data_types_supported"

    unsupported_datasets = df_all_datasets.query(f"not ({cdm_data_type_test})")
    if not unsupported_datasets.empty:
        logger.warn(
            f"\nSkipping datasets because they are not cdm_data_type: \n {unsupported_datasets[['datasetID','cdm_data_type']].to_csv(None,index=False)}"
        )

    df_all_datasets = df_all_datasets.query(cdm_data_type_test)

    if erddap.df_all_datasets.empty:
        raise RuntimeError("No datasets found")
    # loop through each dataset to be processed
    for i, df_dataset_row in df_all_datasets.iterrows():
        dataset_id = df_dataset_row["datasetID"]
        dataset_was_added = False
        try:
            logger.info(f"Querying dataset: {dataset_id} {i+1}/{len(df_all_datasets)}")
            dataset = erddap.get_dataset(dataset_id)
            dataset_logger = dataset.logger

            passes_checks = CEDAComplianceChecker(dataset).passes_all_checks()

            # these are the variables we are pulling max/min values for
            if passes_checks:
                df_profiles = get_profiles(dataset)

                if df_profiles.empty:
                    dataset_logger.warning("No profiles found")
                else:

                    # only write dataset/metadata/profile if there are some profiles
                    df_profiles_all = df_profiles_all.append(df_profiles)
                    df_datasets_all = df_datasets_all.append(dataset.df)
                    df_variables_all = df_variables_all.append(dataset.df_variables)
                    dataset_was_added = True
                    dataset_logger.info("complete")

        except HTTPError as e:
            response = e.response
            # dataset_logger.error(response.text)
            dataset_logger.error(
                f"HTTP ERROR: {response.status_code} {response.reason}"
            )

        except Exception as e:
            print(traceback.format_exc())

        if not dataset_was_added:
            datasets_not_added.append(dataset.get_data_access_form_url())

    # logger.info(record_count)
    logger.info(f"skipped : {len(datasets_not_added)} datasets: {datasets_not_added}")

    # using 'result' to return data from each thread
    result.append(
        [df_profiles_all, df_datasets_all, datasets_not_added, df_variables_all]
    )
