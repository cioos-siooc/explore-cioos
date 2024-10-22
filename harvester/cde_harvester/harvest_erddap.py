#!/usr/bin/env python3

import dataclasses
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
from loguru import logger
from requests.exceptions import HTTPError

# TIMEOUT = 30


@dataclasses.dataclass
class Profile:
    erddap_url: str
    dataset_id: str
    timeseries_id: str
    profile_id: str
    latitude: float
    longitude: float
    depth_min: float
    depth_max: float


@dataclasses.dataclass
class Dataset:
    title: str
    # summary: str
    erddap_url: str
    dataset_id: str
    cdm_data_type: str
    platform: str
    eovs: str
    organizations: str
    n_profiles: float
    profile_variables: str
    timeseries_id_variable: str
    profile_id_variable: str
    trajectory_id_variable: str
    num_columns: int
    first_eov_column: str


@dataclasses.dataclass
class Variable:
    name: str
    type: str
    cf_role: str
    standard_name: str
    erddap_url: str
    dataset_id: str


def dataclass_dtype_dict(dataclass):
    return {field.name: field.type for field in dataclasses.fields(dataclass)}


CDM_DATA_TYPES_SUPPORTED = [
    # "Point",
    "TimeSeries",
    "Profile",
    "TimeSeriesProfile",
    # "Trajectory",
    # "TrajectoryProfile",
]


def get_datasets_to_skip():
    skipped_datasets_path = "skipped_datasets.json"

    if os.path.exists(skipped_datasets_path):
        logger.info("Loading list of datasets to skip from {}", skipped_datasets_path)
        with open(skipped_datasets_path) as f:
            datasets_to_skip = json.load(f)
            return datasets_to_skip
    logger.info(f"No skipped datasets list found")
    return {}


def harvest_erddap_contextualized(erddap_conn, result, cache_requests=False):
    with logger.contextualize( erddap_url=erddap_conn["url"]):
        return harvest_erddap(erddap_conn, result, cache_requests)


def harvest_erddap(erddap_conn, result, cache_requests=False):
    # """ """
    skipped_datasets_reasons = []
    erddap_url = erddap_conn["url"]
    limit_dataset_ids = erddap_conn.get("dataset_ids", None)

    hostname = urlparse(erddap_url).hostname
    datasets_to_skip = get_datasets_to_skip().get(hostname, [])

    def skipped_reason(code):
        return [[erddap.domain, dataset_id, code]]

    erddap = ERDDAP(erddap_conn, cache_requests)
    df_all_datasets = erddap.df_all_datasets

    if df_all_datasets.empty:
        return

    if limit_dataset_ids:
        df_all_datasets = df_all_datasets.query("datasetID in @limit_dataset_ids")

    cdm_data_type_test = "cdm_data_type in @CDM_DATA_TYPES_SUPPORTED"

    unsupported_datasets = df_all_datasets.query(f"not ({cdm_data_type_test})")
    if not unsupported_datasets.empty:
        unsupported_datasets_list = unsupported_datasets["datasetID"].to_list()
        logger.warning(
            "Skipping datasets because cdm_data_type is not {}: {}",
            CDM_DATA_TYPES_SUPPORTED,
            unsupported_datasets_list,
        )
        for dataset_id in unsupported_datasets_list:
            skipped_datasets_reasons += [
                [erddap.domain, dataset_id, CDM_DATA_TYPE_UNSUPPORTED]
            ]

    df_all_datasets = df_all_datasets.query(cdm_data_type_test)

    if erddap.df_all_datasets.empty:
        raise RuntimeError("No datasets found")
    # loop through each dataset to be processed
    profiles_all = []
    datasets_all = []
    variables_all = []
    for i, df_dataset_row in df_all_datasets.iterrows():
        dataset_id = df_dataset_row["datasetID"]
        dataset_url = df_dataset_row['tabledap'] or df_dataset_row['griddap']
        with logger.contextualize(erddap_url=dataset_url):
            if dataset_id in datasets_to_skip:
                logger.info("Skipping dataset: {} because its on the skip list", dataset_id)
                continue
            try:
                logger.info(
                    "Querying dataset: {} {}/{}", dataset_id, i + 1, len(df_all_datasets)
                )
                dataset = erddap.get_dataset(dataset_id)
                compliance_checker = CDEComplianceChecker(dataset)
                passes_checks = compliance_checker.passes_all_checks()

                # these are the variables we are pulling max/min values for
                if passes_checks:
                    df_profiles = get_profiles(dataset)

                    if df_profiles.empty:
                        logger.warning("No profiles found")
                        continue

                    # only write dataset/metadata/profile if there are some profiles
                    profiles_all.append(df_profiles)
                    datasets_all.append(dataset.get_df())
                    variables_all.append(dataset.df_variables)
                    logger.info("complete")
                else:
                    skipped_datasets_reasons += skipped_reason(
                        compliance_checker.failure_reason_code
                    )
            except HTTPError as e:
                response = e.response
                # dataset_logger.error(response.text)
                logger.error("HTTP ERROR: {} {}", response.status_code, response.reason)
                skipped_datasets_reasons += skipped_reason(HTTP_ERROR)

            except Exception as e:
                logger.exception(
                    "Error occurred at {} {}", erddap_url, dataset_id
                )
                skipped_datasets_reasons += skipped_reason(UNKNOWN_ERROR)

    skipped_datasets_columns = ["erddap_url", "dataset_id", "reason_code"]

    if skipped_datasets_reasons:
        df_skipped_datasets = pd.DataFrame(
            skipped_datasets_reasons,
            columns=skipped_datasets_columns,
        )

        # logger.info(record_count)
        logger.info(
            "skipped: {} datasets: {}",
            len(df_skipped_datasets),
            df_skipped_datasets["dataset_id"].to_list(),
        )
    else:
        df_skipped_datasets = pd.DataFrame(columns=skipped_datasets_columns)

    # using 'result' to return data from each thread
    result.append(
        dict(
            profiles=pd.concat(profiles_all).astype(dataclass_dtype_dict(Profile)),
            datasets=pd.concat(datasets_all).astype(dataclass_dtype_dict(Dataset)),
            variables=pd.concat(variables_all).astype(dataclass_dtype_dict(Variable)),
            skipped_datasets=df_skipped_datasets,
        )
    )
