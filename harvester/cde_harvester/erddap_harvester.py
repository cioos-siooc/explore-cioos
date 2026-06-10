#!/usr/bin/env python3

import json
import logging
import os
import time
from dataclasses import dataclass
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
    VerifiedDatasetSchema,
)
from cde_harvester.harvest_errors import (
    CDM_DATA_TYPE_UNSUPPORTED,
    HTTP_ERROR,
    NO_PROFILES_FOUND,
    ON_SKIP_LIST,
    RESPONSE_TOO_LARGE,
    ResponseTooLargeError,
    UNCHANGED,
    UNKNOWN_ERROR,
)
from cde_harvester.dataset_state import load_previous_hashes
from cde_harvester.profiles import get_profiles
from requests.exceptions import HTTPError
from prefect import task

logger = logging.getLogger(__name__)


def _attempt_urls(erddap_url, dataset, dataset_id):
    """URLs to record for a failed attempt. Prefer the dataset's own
    queried_urls, but when the failure happened during construction
    (get_metadata) the dataset object never reached the caller, so fall
    back to the metadata URL — the request that would have run first."""
    queried = getattr(dataset, "queried_urls", None)
    if queried:
        return queried
    return [f"{erddap_url.rstrip('/')}/info/{dataset_id}/index.csv"]


def _build_attempt(run_id, erddap_url, dataset_id, status, reason_code=None,
                   error_message=None, duration_ms=None, query_urls=None):
    """Build one harvest_attempts.csv row (kept identical to the legacy
    record_attempt closure so the harvest-dashboard contract is unchanged)."""
    urls = list(query_urls or [])
    return {
        "run_id": run_id,
        # Store the full configured URL (scheme + host + /erddap path) — not
        # erddap.domain which is just the hostname — so the harvest-dashboard
        # can build correct /tabledap/ links without a server-list lookup.
        # erddap.domain is still used by the skipped_datasets table elsewhere
        # for legacy compatibility.
        "erddap_url": erddap_url.rstrip("/"),
        "dataset_id": dataset_id,
        "source": "erddap",
        "status": status,
        "reason_code": reason_code,
        "error_message": error_message,
        "duration_ms": duration_ms,
        "attempted_at": datetime.now(timezone.utc),
        "query_urls": "\n".join(urls) if urls else None,
    }


@dataclass
class DatasetHarvestResult:
    """Outcome of harvesting a single dataset (success or non-error skip)."""

    status: str                      # "success" | "skipped" | "skipped_unchanged"
    attempt: dict                    # one harvest_attempts.csv row
    profiles: pd.DataFrame = None    # populated only on success
    dataset_df: pd.DataFrame = None
    variables: pd.DataFrame = None
    skipped_reason_code: str = None  # for the skipped_datasets table, on skip
    verified_at: datetime = None     # set on "skipped_unchanged" (bumps verified_at)


class DatasetHarvestError(Exception):
    """Error outcome of harvest_dataset; carries the audit data the caller persists."""

    def __init__(self, attempt, skipped_reason_code, message):
        super().__init__(message)
        self.attempt = attempt                       # error row for harvest_attempts.csv
        self.skipped_reason_code = skipped_reason_code


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

    def __init__(self, erddap_url, limit_dataset_ids=None, cache_requests=False,
                 run_id=None, skip_unchanged=False):
        self.erddap_url = erddap_url
        self.limit_dataset_ids = limit_dataset_ids
        self.cache_requests = cache_requests
        self.run_id = run_id
        self.skip_unchanged = skip_unchanged

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
        verified_rows = []
        hostname = urlparse(self.erddap_url).hostname
        datasets_to_skip = self.get_datasets_to_skip().get(hostname, [])

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
        erddap.df_all_datasets = erddap.get_all_datasets()
        df_all_datasets = erddap.df_all_datasets

        previous_hashes = (
            load_previous_hashes(self.erddap_url) if self.skip_unchanged else {}
        )

        empty_attempts = pd.DataFrame(
            columns=HarvestAttemptSchema.to_schema().columns.keys()
        )
        empty_verified = pd.DataFrame(
            columns=VerifiedDatasetSchema.to_schema().columns.keys()
        )

        if df_all_datasets.empty:
            return HarvestResult(
                profiles=df_profiles_all,
                datasets=df_datasets_all,
                variables=df_variables_all,
                skipped=pd.DataFrame(columns=SkippedDatasetSchema.to_schema().columns.keys()),
                attempts=empty_attempts,
                verified=empty_verified,
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
                # No server request issued; record the skip with the info URL.
                attempt_records.append(_build_attempt(
                    self.run_id, self.erddap_url, dataset_id,
                    status="skipped",
                    reason_code=CDM_DATA_TYPE_UNSUPPORTED,
                    error_message=f"cdm_data_type={cdm_type!r} not in {cdm_data_types_supported}",
                    query_urls=[f"{base}/info/{dataset_id}/index.html"],
                ))

        df_all_datasets = df_all_datasets.query(cdm_data_type_test)

        if erddap.df_all_datasets.empty:
            raise RuntimeError("No datasets found")

        # Pre-filter the skip-list: these issue no server request.
        on_skip_list = [d for d in df_all_datasets["datasetID"] if d in datasets_to_skip]
        for dataset_id in on_skip_list:
            erddap_logger.info(
                f"Skipping dataset: {dataset_id} because its on the skip list"
            )
            skipped_datasets_reasons += [[erddap.domain, dataset_id, ON_SKIP_LIST]]
            attempt_records.append(_build_attempt(
                self.run_id, self.erddap_url, dataset_id,
                status="skipped",
                reason_code=ON_SKIP_LIST,
                error_message="Dataset listed in skipped_datasets.json",
                query_urls=[f"{self.erddap_url.rstrip('/')}/info/{dataset_id}/index.html"],
            ))
        if on_skip_list:
            df_all_datasets = df_all_datasets.query("datasetID not in @on_skip_list")
        # Serial: never hit a server with concurrent requests.
        total = len(df_all_datasets)
        for i, df_dataset_row in enumerate(df_all_datasets.itertuples(index=False)):
            dataset_id = df_dataset_row.datasetID
            try:
                result = harvest_dataset(
                    erddap, dataset_id,
                    previous_hashes=previous_hashes,
                    skip_unchanged=self.skip_unchanged,
                    run_id=self.run_id, idx=i + 1, total=total,
                )
                attempt_records.append(result.attempt)
                if result.status == "success":
                    df_profiles_all = pd.concat([df_profiles_all, result.profiles])
                    df_datasets_all = pd.concat([df_datasets_all, result.dataset_df])
                    df_variables_all = pd.concat([df_variables_all, result.variables])
                elif result.status == "skipped_unchanged":
                    verified_rows.append({
                        "erddap_url": self.erddap_url.rstrip("/"),
                        "dataset_id": dataset_id,
                        "verified_at": result.verified_at,
                    })
                elif result.skipped_reason_code:
                    skipped_datasets_reasons += [
                        [erddap.domain, dataset_id, result.skipped_reason_code]
                    ]
            except DatasetHarvestError as e:
                # Record the error and continue to the next dataset.
                attempt_records.append(e.attempt)
                skipped_datasets_reasons += [
                    [erddap.domain, dataset_id, e.skipped_reason_code]
                ]

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

        df_verified = (
            pd.DataFrame(verified_rows, columns=list(empty_verified.columns))
            if verified_rows else empty_verified
        )
        if verified_rows:
            erddap_logger.info(
                "skipped (unchanged): %s datasets", len(df_verified)
            )

        # Return the results
        return HarvestResult(
            profiles=df_profiles_all,
            datasets=df_datasets_all,
            variables=df_variables_all,
            skipped=df_skipped_datasets,
            attempts=df_attempts,
            verified=df_verified,
        )


def harvest_dataset(erddap, dataset_id, previous_hashes=None, skip_unchanged=False,
                    run_id=None, idx=None, total=None):
    """Harvest one ERDDAP dataset (plain function; reuses `erddap`, never rebuilds it).

    Returns DatasetHarvestResult on success/skip; raises DatasetHarvestError on
    error (carrying the audit row the caller persists).

    When ``skip_unchanged`` and the dataset's Croissant lists files whose hash
    matches ``previous_hashes``, returns early as "skipped_unchanged" — one HTTP
    request, no metadata or profile queries.
    """
    log = erddap.get_logger()
    erddap_url = erddap.url
    t0 = time.monotonic()
    # Pre-declare so the exception handlers can still pull queried_urls if
    # get_dataset() succeeded before failing.
    dataset = None
    progress = f" {idx}/{total}" if idx and total else ""
    try:
        new_hash, has_files = erddap.get_croissant_fingerprint(erddap_url, dataset_id)
        prev_hash = (previous_hashes or {}).get(dataset_id)
        if skip_unchanged and has_files and new_hash and prev_hash == new_hash:
            duration_ms = int((time.monotonic() - t0) * 1000)
            log.info(f"Skipping dataset: {dataset_id}{progress} — unchanged (Croissant hash match)")
            return DatasetHarvestResult(
                status="skipped_unchanged",
                verified_at=datetime.now(timezone.utc),
                attempt=_build_attempt(
                    run_id, erddap_url, dataset_id,
                    status="skipped",
                    reason_code=UNCHANGED,
                    error_message="Croissant file-list hash unchanged since last harvest",
                    duration_ms=duration_ms,
                    query_urls=[f"{erddap_url.rstrip('/')}/info/{dataset_id}/index.html"],
                ),
            )

        log.info(f"Querying dataset: {dataset_id}{progress}")
        dataset = erddap.get_dataset(dataset_id)
        dataset.content_hash = new_hash
        compliance_checker = CDEComplianceChecker(dataset)

        if compliance_checker.passes_all_checks():
            df_profiles = get_profiles(dataset)
            duration_ms = int((time.monotonic() - t0) * 1000)
            if df_profiles.empty:
                log.warning("No profiles found")
                return DatasetHarvestResult(
                    status="skipped",
                    skipped_reason_code=NO_PROFILES_FOUND,
                    attempt=_build_attempt(
                        run_id, erddap_url, dataset_id,
                        status="skipped",
                        reason_code=NO_PROFILES_FOUND,
                        error_message="Dataset passed compliance but get_profiles returned no rows",
                        duration_ms=duration_ms,
                        query_urls=dataset.queried_urls,
                    ),
                )
            log.info("complete")
            return DatasetHarvestResult(
                status="success",
                profiles=df_profiles,
                dataset_df=dataset.get_df(),
                variables=dataset.df_variables,
                attempt=_build_attempt(
                    run_id, erddap_url, dataset_id,
                    status="success",
                    duration_ms=duration_ms,
                    query_urls=dataset.queried_urls,
                ),
            )

        # Failed compliance — a legitimate skip, NOT an error (task stays green).
        duration_ms = int((time.monotonic() - t0) * 1000)
        return DatasetHarvestResult(
            status="skipped",
            skipped_reason_code=compliance_checker.failure_reason_code,
            attempt=_build_attempt(
                run_id, erddap_url, dataset_id,
                status="skipped",
                reason_code=compliance_checker.failure_reason_code,
                error_message=getattr(compliance_checker, "failure_details", None),
                duration_ms=duration_ms,
                query_urls=dataset.queried_urls,
            ),
        )
    except HTTPError as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        response = e.response
        log.error("HTTP ERROR: %s %s", response.status_code, response.reason)
        raise DatasetHarvestError(
            attempt=_build_attempt(
                run_id, erddap_url, dataset_id,
                status="error",
                reason_code=HTTP_ERROR,
                error_message=f"HTTP {response.status_code} {response.reason}",
                duration_ms=duration_ms,
                query_urls=_attempt_urls(erddap_url, dataset, dataset_id),
            ),
            skipped_reason_code=HTTP_ERROR,
            message=f"HTTP {response.status_code} {response.reason} harvesting {dataset_id}",
        ) from e
    except ResponseTooLargeError as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        log.error("Response too large: %s", e)
        raise DatasetHarvestError(
            attempt=_build_attempt(
                run_id, erddap_url, dataset_id,
                status="error",
                reason_code=RESPONSE_TOO_LARGE,
                error_message=str(e),
                duration_ms=duration_ms,
                query_urls=_attempt_urls(erddap_url, dataset, dataset_id),
            ),
            skipped_reason_code=RESPONSE_TOO_LARGE,
            message=f"Response too large harvesting {dataset_id}: {e}",
        ) from e
    except Exception as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        log.error("Error occurred at %s %s", erddap_url, dataset_id, exc_info=True)
        raise DatasetHarvestError(
            attempt=_build_attempt(
                run_id, erddap_url, dataset_id,
                status="error",
                reason_code=UNKNOWN_ERROR,
                error_message=f"{type(e).__name__}: {e}",
                duration_ms=duration_ms,
                query_urls=_attempt_urls(erddap_url, dataset, dataset_id),
            ),
            skipped_reason_code=UNKNOWN_ERROR,
            message=f"{type(e).__name__} harvesting {dataset_id}: {e}",
        ) from e


def _erddap_task_run_name():
    """Task run label 'harvest-erddap-{full-host}' (dots -> dashes), matching the
    'Harvest Source' flow_run_name. Computed locally (not via prefect_pipeline.
    deployment_slug) to avoid a circular import."""
    from prefect.runtime import task_run

    url = (task_run.parameters or {}).get("erddap_url", "") or ""
    host = urlparse(url if "://" in url else "https://" + url).hostname or str(url)
    return f"harvest-erddap-{host.lower().replace('.', '-')}"


@task(task_run_name=_erddap_task_run_name)
def harvest_erddap(erddap_url, limit_dataset_ids=None, cache_requests=False,
                   run_id=None, skip_unchanged=False):
    """Prefect task wrapper for ERDDAPHarvester.

    Stays a @task (not a subflow) so multiple servers harvest concurrently via
    .submit() — Prefect subflows run sequentially, tasks don't.
    """
    harvester = ERDDAPHarvester(
        erddap_url, limit_dataset_ids, cache_requests,
        run_id=run_id, skip_unchanged=skip_unchanged,
    )
    return harvester.harvest()
