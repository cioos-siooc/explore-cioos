#!/usr/bin/env python3

import json
import logging
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import pandas as pd
from cde_harvester.base_harvester import BaseHarvester, HarvestResult
from cde_harvester.CDEComplianceChecker import CDEComplianceChecker
from cde_harvester.ERDDAP import ERDDAP
from cde_harvester.schemas import (
    DatasetSchema,
    HarvestAttemptSchema,
    ProfileSchema,
    SkippedDatasetSchema,
    VariableSchema,
)
from cde_harvester.harvest_errors import (
    CDM_DATA_TYPE_UNSUPPORTED,
    HTTP_ERROR,
    NO_PROFILES_FOUND,
    ON_SKIP_LIST,
    RESPONSE_TOO_LARGE,
    ResponseTooLargeError,
    UNKNOWN_ERROR,
)
from cde_harvester.profiles import get_profiles
from requests.exceptions import HTTPError
from prefect import task

logger = logging.getLogger(__name__)


class ERDDAPHarvester(BaseHarvester):
    """Harvester for ERDDAP servers."""

    CDM_DATA_TYPES_SUPPORTED = [
        # "Point",
        "TimeSeries",
        "Profile",
        "TimeSeriesProfile",
        # "Trajectory",
        # "TrajectoryProfile",
    ]

    def __init__(self, erddap_url, limit_dataset_ids=None, cache_requests=False, run_id=None):
        self.erddap_url = erddap_url
        self.limit_dataset_ids = limit_dataset_ids
        self.cache_requests = cache_requests
        self.run_id = run_id

    def _attempt_urls(self, dataset, dataset_id):
        """URLs to record for a failed attempt. Prefer the dataset's own
        queried_urls, but when the failure happened during construction
        (get_metadata) the dataset object never reached the caller, so fall
        back to the metadata URL — the request that would have run first."""
        queried = getattr(dataset, "queried_urls", None)
        if queried:
            return queried
        return [f"{self.erddap_url.rstrip('/')}/info/{dataset_id}/index.csv"]

    @staticmethod
    def get_datasets_to_skip():
        skipped_datasets_path = "skipped_datasets.json"

        if os.path.exists(skipped_datasets_path):
            logger.info(
                f"Loading list of datasets to skip from {skipped_datasets_path}"
            )
            with open(skipped_datasets_path) as f:
                datasets_to_skip = json.load(f)
                return datasets_to_skip
        logger.info(f"No skipped datasets list found")
        return {}

    def harvest(self) -> HarvestResult:
        skipped_datasets_reasons = []
        attempt_records = []
        hostname = urlparse(self.erddap_url).hostname
        datasets_to_skip = self.get_datasets_to_skip().get(hostname, [])

        def skipped_reason(code):
            return [[erddap.domain, dataset_id, code]]

        def record_attempt(dataset_id, status, reason_code=None,
                           error_message=None, duration_ms=None,
                           erddap_url_override=None, query_urls=None):
            base_url = (erddap_url_override or self.erddap_url).rstrip("/")
            urls = list(query_urls or [])
            attempt_records.append({
                "run_id": self.run_id,
                # Store the full configured URL (scheme + host + /erddap path)
                # — not erddap.domain which is just the hostname — so the
                # harvest-dashboard can build correct /tabledap/ links without
                # a server-list lookup. erddap.domain is still used by the
                # skipped_datasets table elsewhere for legacy compatibility.
                "erddap_url": base_url,
                "dataset_id": dataset_id,
                "source": "erddap",
                "status": status,
                "reason_code": reason_code,
                "error_message": error_message,
                "duration_ms": duration_ms,
                "attempted_at": datetime.now(timezone.utc),
                "query_urls": "\n".join(urls) if urls else None,
            })

        df_profiles_all = pd.DataFrame(
            columns=ProfileSchema.to_schema().columns.keys()
        )
        df_datasets_all = pd.DataFrame(
            columns=DatasetSchema.to_schema().columns.keys()
        )
        df_variables_all = pd.DataFrame(
            columns=VariableSchema.to_schema().columns.keys()
        )

        erddap = ERDDAP(self.erddap_url, self.cache_requests)
        erddap_logger = erddap.get_logger()
        df_all_datasets = erddap.df_all_datasets

        empty_attempts = pd.DataFrame(
            columns=HarvestAttemptSchema.to_schema().columns.keys()
        )

        if df_all_datasets.empty:
            return HarvestResult(
                profiles=df_profiles_all,
                datasets=df_datasets_all,
                variables=df_variables_all,
                skipped=pd.DataFrame(columns=SkippedDatasetSchema.to_schema().columns.keys()),
                attempts=empty_attempts,
            )

        cdm_data_types_supported = self.CDM_DATA_TYPES_SUPPORTED
        if self.limit_dataset_ids:
            df_all_datasets = df_all_datasets.query(
                "datasetID in @self.limit_dataset_ids"
            )

        cdm_data_type_test = "cdm_data_type in @cdm_data_types_supported"

        unsupported_datasets = df_all_datasets.query(f"not ({cdm_data_type_test})")
        if not unsupported_datasets.empty:
            unsupported_datasets_list = unsupported_datasets["datasetID"].to_list()
            erddap_logger.warning(
                f"Skipping datasets because cdm_data_type is not {str(cdm_data_types_supported)}: {unsupported_datasets_list}"
            )
            base = self.erddap_url.rstrip("/")
            for dataset_id in unsupported_datasets_list:
                skipped_datasets_reasons += [
                    [erddap.domain, dataset_id, CDM_DATA_TYPE_UNSUPPORTED]
                ]
                cdm_type = unsupported_datasets.loc[
                    unsupported_datasets["datasetID"] == dataset_id, "cdm_data_type"
                ].iloc[0]
                record_attempt(
                    dataset_id,
                    status="skipped",
                    reason_code=CDM_DATA_TYPE_UNSUPPORTED,
                    error_message=f"cdm_data_type={cdm_type!r} not in {cdm_data_types_supported}",
                    # No request was issued for this dataset (we filtered it
                    # from allDatasets). Surface the URL the admin would
                    # inspect to verify cdm_data_type.
                    query_urls=[f"{base}/info/{dataset_id}/index.html"],
                )

        df_all_datasets = df_all_datasets.query(cdm_data_type_test)

        if erddap.df_all_datasets.empty:
            raise RuntimeError("No datasets found")
        # loop through each dataset to be processed
        for i, df_dataset_row in df_all_datasets.iterrows():
            dataset_id = df_dataset_row["datasetID"]
            if dataset_id in datasets_to_skip:
                erddap_logger.info(
                    f"Skipping dataset: {dataset_id} because its on the skip list"
                )
                record_attempt(
                    dataset_id,
                    status="skipped",
                    reason_code=ON_SKIP_LIST,
                    error_message="Dataset listed in skipped_datasets.json",
                    query_urls=[f"{self.erddap_url.rstrip('/')}/info/{dataset_id}/index.html"],
                )
                continue
            t0 = time.monotonic()
            # Pre-declare so exception handlers (HTTPError / generic Exception)
            # can still pull queried_urls if get_dataset() succeeded before failing.
            dataset = None
            dataset_logger = erddap_logger
            try:
                erddap_logger.info(
                    f"Querying dataset: {dataset_id} {i+1}/{len(df_all_datasets)}"
                )
                dataset = erddap.get_dataset(dataset_id)
                dataset_logger = dataset.logger
                compliance_checker = CDEComplianceChecker(dataset)
                passes_checks = compliance_checker.passes_all_checks()

                # these are the variables we are pulling max/min values for
                if passes_checks:
                    df_profiles = get_profiles(dataset)
                    duration_ms = int((time.monotonic() - t0) * 1000)

                    if df_profiles.empty:
                        dataset_logger.warning("No profiles found")
                        record_attempt(
                            dataset_id,
                            status="skipped",
                            reason_code=NO_PROFILES_FOUND,
                            error_message="Dataset passed compliance but get_profiles returned no rows",
                            duration_ms=duration_ms,
                            query_urls=dataset.queried_urls,
                        )
                    else:
                        # only write dataset/metadata/profile if there are some profiles
                        df_profiles_all = pd.concat([df_profiles_all, df_profiles])
                        df_datasets_all = pd.concat(
                            [df_datasets_all, dataset.get_df()]
                        )
                        df_variables_all = pd.concat(
                            [df_variables_all, dataset.df_variables]
                        )
                        dataset_logger.info("complete")
                        record_attempt(
                            dataset_id,
                            status="success",
                            duration_ms=duration_ms,
                            query_urls=dataset.queried_urls,
                        )
                else:
                    duration_ms = int((time.monotonic() - t0) * 1000)
                    skipped_datasets_reasons += skipped_reason(
                        compliance_checker.failure_reason_code
                    )
                    record_attempt(
                        dataset_id,
                        status="skipped",
                        reason_code=compliance_checker.failure_reason_code,
                        error_message=getattr(compliance_checker, "failure_details", None),
                        duration_ms=duration_ms,
                        query_urls=dataset.queried_urls,
                    )
            except HTTPError as e:
                duration_ms = int((time.monotonic() - t0) * 1000)
                response = e.response
                dataset_logger.error(
                    "HTTP ERROR: %s %s", response.status_code, response.reason
                )
                skipped_datasets_reasons += skipped_reason(HTTP_ERROR)
                record_attempt(
                    dataset_id,
                    status="error",
                    reason_code=HTTP_ERROR,
                    error_message=f"HTTP {response.status_code} {response.reason}",
                    duration_ms=duration_ms,
                    query_urls=self._attempt_urls(dataset, dataset_id),
                )

            except ResponseTooLargeError as e:
                duration_ms = int((time.monotonic() - t0) * 1000)
                dataset_logger.error("Response too large: %s", e)
                skipped_datasets_reasons += skipped_reason(RESPONSE_TOO_LARGE)
                record_attempt(
                    dataset_id,
                    status="error",
                    reason_code=RESPONSE_TOO_LARGE,
                    error_message=str(e),
                    duration_ms=duration_ms,
                    query_urls=self._attempt_urls(dataset, dataset_id),
                )

            except Exception as e:
                duration_ms = int((time.monotonic() - t0) * 1000)
                erddap_logger.error(
                    "Error occurred at %s %s",
                    self.erddap_url,
                    dataset_id,
                    exc_info=True,
                )
                skipped_datasets_reasons += skipped_reason(UNKNOWN_ERROR)
                record_attempt(
                    dataset_id,
                    status="error",
                    reason_code=UNKNOWN_ERROR,
                    error_message=f"{type(e).__name__}: {e}",
                    duration_ms=duration_ms,
                    query_urls=self._attempt_urls(dataset, dataset_id),
                )

        skipped_columns = list(SkippedDatasetSchema.to_schema().columns.keys())

        if skipped_datasets_reasons:
            df_skipped_datasets = pd.DataFrame(
                skipped_datasets_reasons,
                columns=skipped_columns,
            )

            erddap_logger.info(
                "skipped: %s datasets: %s",
                len(df_skipped_datasets),
                df_skipped_datasets["dataset_id"].to_list(),
            )
        else:
            df_skipped_datasets = pd.DataFrame(columns=skipped_columns)

        df_attempts = (
            pd.DataFrame(attempt_records) if attempt_records else empty_attempts
        )

        # Return the results
        return HarvestResult(
            profiles=df_profiles_all,
            datasets=df_datasets_all,
            variables=df_variables_all,
            skipped=df_skipped_datasets,
            attempts=df_attempts,
        )


@task(task_run_name="harvest-{erddap_url}")
def harvest_erddap(erddap_url, limit_dataset_ids=None, cache_requests=False, run_id=None):
    """Prefect task wrapper for ERDDAPHarvester."""
    harvester = ERDDAPHarvester(erddap_url, limit_dataset_ids, cache_requests, run_id=run_id)
    return harvester.harvest()
