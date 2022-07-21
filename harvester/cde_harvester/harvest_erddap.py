#!/usr/bin/env python3

import traceback

import pandas as pd
from cde_harvester.CDEComplianceChecker import CDEComplianceChecker
from cde_harvester.ERDDAP import ERDDAP
from cde_harvester.harvest_errors import (CDM_DATA_TYPE_UNSUPPORTED,
                                          HTTP_ERROR, UNKNOWN_ERROR)
from cde_harvester.profiles import get_profiles
from requests.exceptions import HTTPError

# TIMEOUT = 30


def harvest_erddap(erddap_url, result, limit_dataset_ids=None, cache_requests=False):
    # """ """
    skipped_datasets_reasons = []

    def skipped_reason(code):
        return [[erddap.domain, dataset_id, code]]

    df_profiles_all = pd.DataFrame()

    df_datasets_all = pd.DataFrame(
        columns=["erddap_url", "dataset_id", "cdm_data_type", "platform"]
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
        unsupported_datasets_list = unsupported_datasets["datasetID"].to_list()
        logger.warn(
            f"Skipping datasets because cdm_data_type is not {str(cdm_data_types_supported)}: {unsupported_datasets_list}"
        )
        for dataset_id in unsupported_datasets_list:
            skipped_datasets_reasons += [
                [erddap.domain, dataset_id, CDM_DATA_TYPE_UNSUPPORTED]
            ]

    df_all_datasets = df_all_datasets.query(cdm_data_type_test)

    if erddap.df_all_datasets.empty:
        raise RuntimeError("No datasets found")
    # loop through each dataset to be processed
    for i, df_dataset_row in df_all_datasets.iterrows():
        dataset_id = df_dataset_row["datasetID"]

        try:
            logger.info(f"Querying dataset: {dataset_id} {i+1}/{len(df_all_datasets)}")
            dataset = erddap.get_dataset(dataset_id)
            dataset_logger = dataset.logger
            compliance_checker = CDEComplianceChecker(dataset)
            passes_checks = compliance_checker.passes_all_checks()

            # these are the variables we are pulling max/min values for
            if passes_checks:
                df_profiles = get_profiles(dataset)

                if df_profiles.empty:
                    dataset_logger.warning("No profiles found")
                else:

                    # only write dataset/metadata/profile if there are some profiles
                    df_profiles_all = pd.concat([df_profiles_all, df_profiles])
                    df_datasets_all = pd.concat([df_datasets_all, dataset.get_df()])
                    df_variables_all = pd.concat(
                        [df_variables_all, dataset.df_variables]
                    )
                    dataset_logger.info("complete")
            else:
                skipped_datasets_reasons += skipped_reason(
                    compliance_checker.failure_reason_code
                )
        except HTTPError as e:
            response = e.response
            # dataset_logger.error(response.text)
            dataset_logger.error(
                f"HTTP ERROR: {response.status_code} {response.reason}"
            )
            skipped_datasets_reasons += skipped_reason(HTTP_ERROR)

        except Exception as e:
            print(traceback.format_exc())
            print("Error occurred at ", erddap_url, dataset_id)
            skipped_datasets_reasons += skipped_reason(UNKNOWN_ERROR)

    skipped_datasets_columns = ["erddap_url", "dataset_id", "reason_code"]

    if skipped_datasets_reasons:
        df_skipped_datasets = pd.DataFrame(
            skipped_datasets_reasons,
            columns=skipped_datasets_columns,
        )

        # logger.info(record_count)
        logger.info(
            f"skipped: {len(df_skipped_datasets)} datasets: {df_skipped_datasets['dataset_id'].to_list()}"
        )
    else:
        df_skipped_datasets = pd.DataFrame(columns=skipped_datasets_columns)

    # using 'result' to return data from each thread
    result.append(
        [
            df_profiles_all,
            df_datasets_all,
            df_variables_all,
            df_skipped_datasets,
        ]
    )
