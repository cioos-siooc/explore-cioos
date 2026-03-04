#!/usr/bin/env python3

import json
import logging
import os
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
from prefect import task

logger = logging.getLogger(__name__)

CDM_DATA_TYPES_SUPPORTED = [
    "TimeSeries",
    "Profile",
    "TimeSeriesProfile",
]

SKIPPED_COLUMNS = ["erddap_url", "dataset_id", "reason_code"]

_PROFILES_SCHEMA = {
    "erddap_url": str,
    "dataset_id": str,
    "timeseries_id": str,
    "profile_id": str,
    "latitude": float,
    "longitude": float,
    "depth_min": float,
    "depth_max": float,
}

_DATASET_SCHEMA = {
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

_VARIABLES_COLUMNS = ["name", "type", "cf_role", "standard_name", "erddap_url", "dataset_id"]


def _empty_result():
    return (
        pd.DataFrame(_PROFILES_SCHEMA, index=[]),
        pd.DataFrame(_DATASET_SCHEMA, index=[]),
        pd.DataFrame(columns=_VARIABLES_COLUMNS),
        pd.DataFrame(columns=SKIPPED_COLUMNS),
    )


def get_datasets_to_skip():
    skipped_datasets_path = "skipped_datasets.json"
    if os.path.exists(skipped_datasets_path):
        logger.info(f"Loading list of datasets to skip from {skipped_datasets_path}")
        with open(skipped_datasets_path) as f:
            return json.load(f)
    logger.info("No skipped datasets list found")
    return {}


@task(task_run_name="prepare-server-{erddap_url}")
def prepare_server(erddap_url, limit_dataset_ids, cache_requests):
    """
    Fetch allDatasets.csv once for the server, filter by supported CDM types,
    and return the list of dataset IDs to harvest plus any immediately-skipped rows.
    """
    erddap = ERDDAP(erddap_url, cache_requests)
    task_logger = erddap.logger
    df_all = erddap.df_all_datasets

    if df_all is None or df_all.empty:
        task_logger.warning("No datasets found at %s", erddap_url)
        return [], pd.DataFrame(columns=SKIPPED_COLUMNS)

    if limit_dataset_ids:
        df_all = df_all.query("datasetID in @limit_dataset_ids")

    unsupported = df_all.query("cdm_data_type not in @CDM_DATA_TYPES_SUPPORTED")
    if not unsupported.empty:
        ids = unsupported["datasetID"].tolist()
        task_logger.warning(
            "Skipping %d datasets with unsupported cdm_data_type: %s", len(ids), ids
        )
        initial_skipped = pd.DataFrame(
            [[erddap.domain, did, CDM_DATA_TYPE_UNSUPPORTED] for did in ids],
            columns=SKIPPED_COLUMNS,
        )
    else:
        initial_skipped = pd.DataFrame(columns=SKIPPED_COLUMNS)

    datasets_to_skip = get_datasets_to_skip().get(urlparse(erddap_url).hostname, [])
    supported = df_all.query("cdm_data_type in @CDM_DATA_TYPES_SUPPORTED")
    dataset_ids = [
        did for did in supported["datasetID"].tolist()
        if did not in datasets_to_skip
    ]

    return dataset_ids, initial_skipped


@task(task_run_name="check-dataset-{dataset_id}")
def check_dataset(erddap_url, dataset_id, cache_requests):
    """
    Run compliance checks against the dataset metadata.

    Returns (passed, skipped_df).
    skipped_df has one row on failure, is empty on success.
    """
    erddap = ERDDAP(erddap_url, cache_requests, skip_all_datasets=True)
    domain = erddap.domain
    empty_skipped = pd.DataFrame(columns=SKIPPED_COLUMNS)

    def skipped_row(code):
        return pd.DataFrame([[domain, dataset_id, code]], columns=SKIPPED_COLUMNS)

    try:
        dataset = erddap.get_dataset(dataset_id)
        compliance_checker = CDEComplianceChecker(dataset)

        if not compliance_checker.passes_all_checks():
            return False, skipped_row(compliance_checker.failure_reason_code)

        return True, empty_skipped

    except HTTPError as e:
        response = e.response
        logger.error(
            "HTTP ERROR checking %s %s: %s %s",
            erddap_url, dataset_id, response.status_code, response.reason,
        )
        return False, skipped_row(HTTP_ERROR)

    except Exception:
        logger.error("Error checking %s %s", erddap_url, dataset_id, exc_info=True)
        return False, skipped_row(UNKNOWN_ERROR)


@task(task_run_name="fetch-profiles-{dataset_id}")
def fetch_profiles(erddap_url, dataset_id, cache_requests):
    """
    Fetch profile data and dataset metadata for a compliant dataset.

    get_profiles() calls get_profile_ids() which sets dataset.profile_ids —
    required by dataset.get_df() — so all three are retrieved here in the
    correct order.

    Returns (profiles_df, dataset_df, variables_df).
    """
    erddap = ERDDAP(erddap_url, cache_requests, skip_all_datasets=True)

    try:
        dataset = erddap.get_dataset(dataset_id)
        df_profiles = get_profiles(dataset)  # sets dataset.profile_ids as side effect
        if df_profiles.empty:
            dataset.logger.warning("No profiles found for %s", dataset_id)
            return (
                pd.DataFrame(_PROFILES_SCHEMA, index=[]),
                dataset.get_df(),
                dataset.df_variables,
            )
        return df_profiles, dataset.get_df(), dataset.df_variables

    except HTTPError as e:
        response = e.response
        logger.error(
            "HTTP ERROR fetching profiles for %s %s: %s %s",
            erddap_url, dataset_id, response.status_code, response.reason,
        )
        return (
            pd.DataFrame(_PROFILES_SCHEMA, index=[]),
            pd.DataFrame(_DATASET_SCHEMA, index=[]),
            pd.DataFrame(columns=_VARIABLES_COLUMNS),
        )

    except Exception:
        logger.error("Error fetching profiles for %s %s", erddap_url, dataset_id, exc_info=True)
        return (
            pd.DataFrame(_PROFILES_SCHEMA, index=[]),
            pd.DataFrame(_DATASET_SCHEMA, index=[]),
            pd.DataFrame(columns=_VARIABLES_COLUMNS),
        )


