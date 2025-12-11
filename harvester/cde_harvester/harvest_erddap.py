#!/usr/bin/env python3

import json
import logging
import os
import traceback
from urllib.parse import urlparse

import pandas as pd
from cde_harvester.CDEComplianceChecker import CDEComplianceChecker
from cde_harvester.ERDDAP import ERDDAP
from cde_harvester.harvest_errors import (
    CDM_DATA_TYPE_UNSUPPORTED,
    HTTP_ERROR,
    UNKNOWN_ERROR,
)
from cde_harvester.profiles import get_profiles
from requests.exceptions import HTTPError

# TIMEOUT = 30
logger = logging.getLogger(__name__)


def get_datasets_to_skip():
    skipped_datasets_path = "skipped_datasets.json"

    if os.path.exists(skipped_datasets_path):
        logger.info(f"Loading list of datasets to skip from {skipped_datasets_path}")
        with open(skipped_datasets_path) as f:
            datasets_to_skip = json.load(f)
            return datasets_to_skip
    logger.info(f"No skipped datasets list found")
    return {}


def harvest_erddap(erddap_url, result, limit_dataset_ids=None, cache_requests=False):
    # """ """
    skipped_datasets_reasons = []
    hostname = urlparse(erddap_url).hostname
    datasets_to_skip = get_datasets_to_skip().get(hostname, [])

    def skipped_reason(code, error_trace=""):
        # Combine error code and trace in the reason_code field
        if error_trace:
            full_reason = f"{code}\n\n{error_trace}"
        else:
            full_reason = code
        return [[erddap.domain, dataset_id, full_reason]]

    profiles_variables = {
        "erddap_url": str,
        "dataset_id": str,
        "timeseries_id": str,
        "profile_id": str,
        "latitude": float,
        "longitude": float,
        "depth_min": float,
        "depth_max": float,
    }

    df_profiles_all = pd.DataFrame(profiles_variables, index=[])

    dataset_variables = {
        "title": str,
        "summary": str,
        "erddap_url": str,
        "dataset_id": str,
        "cdm_data_type": str,
        "platform": str,
        "eovs": str,
        "organizations": str,
        "n_profiles": float,
        "profile_variables": str,
        "timeseries_id_variable": str,
        "profile_id_variable": str,
        "trajectory_id_variable": str,
        "num_columns": int,
        "first_eov_column": str,
    }
    df_datasets_all = pd.DataFrame(dataset_variables, index=[])

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

    if df_all_datasets.empty:
        return

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
            cdm_type = unsupported_datasets[unsupported_datasets["datasetID"] == dataset_id]["cdm_data_type"].values[0]
            error_msg = f"CDM data type '{cdm_type}' not in supported types: {cdm_data_types_supported}"
            skipped_datasets_reasons += skipped_reason(CDM_DATA_TYPE_UNSUPPORTED, error_msg)

    df_all_datasets = df_all_datasets.query(cdm_data_type_test)

    if erddap.df_all_datasets.empty:
        raise RuntimeError("No datasets found")
    # loop through each dataset to be processed
    for i, df_dataset_row in df_all_datasets.iterrows():
        dataset_id = df_dataset_row["datasetID"]
        if dataset_id in datasets_to_skip:
            logger.info(f"Skipping dataset: {dataset_id} because its on the skip list")
            continue
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
                error_trace = compliance_checker.get_failure_details()
                skipped_datasets_reasons += skipped_reason(
                    compliance_checker.failure_reason_code,
                    error_trace
                )
        except HTTPError as e:
            response = e.response
            # Capture full HTTP error details including traceback
            error_trace = (
                f"HTTP {response.status_code} {response.reason}\n"
                f"URL: {response.url}\n"
                f"Response: {response.text[:500]}\n"
                f"Traceback:\n{''.join(traceback.format_tb(e.__traceback__))}"
            )
            dataset_logger.error(
                "HTTP ERROR: %s %s", response.status_code, response.reason
            )
            skipped_datasets_reasons += skipped_reason(HTTP_ERROR, error_trace)

        except Exception as e:
            # Capture full exception traceback
            error_trace = ''.join(traceback.format_exception(type(e), e, e.__traceback__))
            logger.error(
                "Error occurred at %s %s", erddap_url, dataset_id, exc_info=True
            )
            skipped_datasets_reasons += skipped_reason(UNKNOWN_ERROR, error_trace)

    skipped_datasets_columns = ["erddap_url", "dataset_id", "reason_code"]

    if skipped_datasets_reasons:
        df_skipped_datasets = pd.DataFrame(
            skipped_datasets_reasons,
            columns=skipped_datasets_columns,
        )

        # logger.info(record_count)
        logger.info(
            "skipped: %s datasets: %s",
            len(df_skipped_datasets),
            df_skipped_datasets["dataset_id"].to_list(),
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
