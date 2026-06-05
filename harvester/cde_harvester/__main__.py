import argparse
import base64
import json
import logging
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import sentry_sdk
import yaml
from cde_harvester.ckan.create_ckan_erddap_link import (
    get_ckan_records,
    unescape_ascii,
    unescape_ascii_list,
)
from cde_harvester.erddap_harvester import harvest_erddap
from cde_harvester.obis_geo_filter import ObisGeoFilter
from cde_harvester.obis_harvester import harvest_obis
from cde_harvester.schemas import HarvestAttemptSchema
from cde_harvester.utils import cf_standard_names, supported_standard_names
from dotenv import load_dotenv
from sentry_sdk.crons import monitor
from sentry_sdk.integrations.logging import LoggingIntegration
from prefect import flow, get_run_logger, task

load_dotenv()

logging.getLogger("urllib3").setLevel(logging.WARNING)
logger = logging.getLogger()

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[
        LoggingIntegration(
            level=logging.INFO,  # Capture info and above as breadcrumbs
            event_level=logging.WARNING,  # Send records as events
        ),
    ],
    environment=os.environ.get("ENVIRONMENT", "development"),
)

# Ignored standard names that are not EOVs, mostly coordinate variables
IGNORED_STANDARD_NAMES= ["latitude", "longitude", "time", "depth", "","altitude","sea_water_pressure","sea_water_pressure_due_to_sea_water"]

def cleanup_old_logs(log_dir, days=30):
    """Remove log files older than specified days."""
    if not os.path.exists(log_dir):
        return

    cutoff_time = time.time() - (days * 86400)  # 86400 seconds in a day
    removed_count = 0

    for filename in os.listdir(log_dir):
        if filename.startswith("harvest_") and filename.endswith(".log"):
            filepath = os.path.join(log_dir, filename)
            if os.path.isfile(filepath) and os.path.getmtime(filepath) < cutoff_time:
                try:
                    os.remove(filepath)
                    removed_count += 1
                    logger.info(f"Removed old log file: {filename}")
                except OSError as e:
                    logger.warning(f"Warning: Failed to remove old log file {filename}: {e}")

    if removed_count > 0:
        logger.info(f"Cleaned up {removed_count} log file(s) older than {days} days")


def setup_logging(log_time, log_level, log_dir=None):
    # Clean up old log files before setting up logging
    if log_dir:
        cleanup_old_logs(log_dir, days=30)

    # setup logging
    logger.setLevel(logging.getLevelName(log_level.upper()))
    logger.handlers.clear()

    # Define log format
    log_format = (
        ("%(asctime)s - " if log_time else "")
        + "%(levelname)-8s - %(name)s : %(message)s"
    )

    # Add console handler
    c_handler = logging.StreamHandler()
    c_handler.setLevel(logging.getLevelName(log_level.upper()))
    c_format = logging.Formatter(log_format)
    c_handler.setFormatter(c_format)
    logger.addHandler(c_handler)

    # Add file handler with timestamped filename if log directory is specified
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = os.path.join(log_dir, f"harvest_{timestamp}.log")

        f_handler = logging.FileHandler(log_file)
        f_handler.setLevel(logging.getLevelName(log_level.upper()))
        f_format = logging.Formatter(
            "%(asctime)s - %(levelname)-8s - %(name)s : %(message)s"
        )
        f_handler.setFormatter(f_format)
        logger.addHandler(f_handler)
        logger.info(f"Logging to file: {log_file}")

    return logger

def _resolve_git_sha():
    """Best-effort git SHA for the harvester source. Returns None if unavailable."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True, text=True, timeout=2,
        )
        if out.returncode == 0:
            return out.stdout.strip() or None
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    return os.environ.get("GIT_SHA") or None


# OBIS is harvested as one monolithic source; in the audit it is recorded
# under this sentinel erddap_url (obis_harvester.OBIS_SOURCE_URL). Accept a few
# spellings so a dashboard/UI caller can ask for OBIS without knowing the exact
# sentinel.
_OBIS_ALIASES = {"obis", "https://obis.org", "http://obis.org", "obis.org"}


def _resolve_source(source, erddap_urls_list):
    """Resolve a requested ``source`` to a single ERDDAP url or the literal 'obis'.

    Lenient on input: accepts the full configured URL, its hostname, the
    dashboard's urlsafe-base64 slug, or an OBIS alias. Returns None when
    ``source`` is falsy (= full harvest, no narrowing).

    Raises ValueError if it does not resolve to exactly one configured source.
    A typo MUST hard-fail before any harvest or DB write — a silently-empty
    single-source harvest could otherwise be mistaken for "this source has no
    datasets".
    """
    if not source:
        return None
    s = str(source).strip()
    candidates = {s, s.rstrip("/")}
    # The dashboard slugifies erddap_url as urlsafe-base64 (slug.py); accept it.
    try:
        decoded = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode("utf-8").strip()
        candidates.update({decoded, decoded.rstrip("/")})
    except Exception:
        pass
    if candidates & _OBIS_ALIASES:
        return "obis"

    def _host(u):
        try:
            return urlparse(u if "://" in u else "https://" + u).hostname
        except Exception:
            return None

    cand_norm = {c.rstrip("/") for c in candidates}
    cand_hosts = {_host(c) for c in candidates if c}
    matches = []
    for url in erddap_urls_list:
        if url.rstrip("/") in cand_norm or (_host(url) and _host(url) in cand_hosts):
            matches.append(url)
    matches = list(dict.fromkeys(matches))
    if len(matches) == 1:
        return matches[0]
    raise ValueError(
        f"source {source!r} did not resolve to exactly one configured source "
        f"(matched {matches}; configured ERDDAP urls: {erddap_urls_list})"
    )


# Order statuses worst-first so failures sort to the top of the artifact table.
_STATUS_SORT = {"error": 0, "skipped": 1, "success": 2}


def _publish_status_artifact(df_attempts, run_id, run_status, logger):
    """Publish the per-dataset harvest status as a Prefect table artifact (keyed
    'harvest-dataset-status') so it shows in the run's Artifacts tab. No-op
    (debug-logged) outside a flow/task run context — never fails the run."""
    try:
        from prefect.artifacts import create_table_artifact
    except Exception:
        return
    if df_attempts is None or df_attempts.empty:
        return

    # Readable subset; drop run_id (constant), query_urls (long) and attempted_at.
    cols = ["dataset_id", "source", "status", "reason_code", "duration_ms",
            "error_message", "erddap_url"]
    df = df_attempts[[c for c in cols if c in df_attempts.columns]].copy()
    if "status" in df.columns:
        df = (
            df.assign(_o=df["status"].map(lambda s: _STATUS_SORT.get(s, 3)))
            .sort_values(["_o", "dataset_id"])
            .drop(columns="_o")
        )
    # JSON-safe rows: NaN/NaT -> None.
    rows = [
        {k: (None if pd.isna(v) else v) for k, v in r.items()}
        for r in df.to_dict("records")
    ]
    counts = (
        df["status"].value_counts().to_dict() if "status" in df.columns else {}
    )
    summary = ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "no attempts"
    try:
        create_table_artifact(
            key="harvest-dataset-status",
            table=rows,
            description=f"Per-dataset harvest status (run {run_id}, {run_status}): {summary}",
        )
        logger.info("Published dataset-status Prefect artifact (%d rows): %s", len(rows), summary)
    except Exception as e:
        logger.debug("Could not publish dataset-status artifact: %s", e)


def _write_run_audit_csvs(folder, run_id, started_at, finished_at, git_sha,
                          status, error_message, attempts_frames, logger,
                          prefect_flow_run_id=None, scope="full",
                          triggered_source=None, triggered_by=None):
    """Write harvest_runs.csv and harvest_attempts.csv into the harvest folder.

    Always called at the end of a run (success or failure) so the
    harvest-dashboard service has a consistent audit trail per-run.
    """
    if not os.path.exists(folder):
        os.makedirs(folder, exist_ok=True)

    runs_file = f"{folder}/harvest_runs.csv"
    attempts_file = f"{folder}/harvest_attempts.csv"

    run_row = pd.DataFrame([{
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "git_sha": git_sha,
        "status": status,
        "error_message": error_message,
        "prefect_flow_run_id": prefect_flow_run_id,
        "scope": scope,
        "triggered_source": triggered_source,
        "triggered_by": triggered_by,
    }])
    run_row.to_csv(runs_file, index=False)

    attempt_columns = list(HarvestAttemptSchema.to_schema().columns.keys())
    frames = [f for f in attempts_frames if f is not None and not f.empty]
    if frames:
        df_attempts = pd.concat(frames, ignore_index=True)
    else:
        df_attempts = pd.DataFrame(columns=attempt_columns)
    df_attempts.to_csv(attempts_file, index=False)

    logger.info(
        "Wrote run audit: %s (status=%s) + %s (%d attempts)",
        runs_file, status, attempts_file, len(df_attempts),
    )

    # Surface the same per-dataset statuses in the Prefect UI as a table artifact.
    _publish_status_artifact(df_attempts, run_id, status, logger)


def _run_logger():
    """Prefect run logger when inside a run, else the module logger.

    `main` is a plain function now (no longer a @flow), so it can be called
    outside a flow context (the bare CLI wraps it in an ad-hoc flow, but the
    fallback keeps it safe regardless).
    """
    try:
        return get_run_logger()
    except Exception:
        return logger


@task(task_run_name="merge-and-write-csvs")
def merge_and_write_csvs(folder, erddap_datasets, erddap_profiles, erddap_skipped,
                         obis_datasets, obis_cells, obis_skipped, df_ckan):
    """Join CKAN metadata, merge all sources, and write the output CSVs (@task)."""
    logger = _run_logger()
    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    ckan_file = f"{folder}/ckan.csv"
    obis_cells_file = f"{folder}/obis_cells.csv"

    # --- ERDDAP-specific post-processing ---
    if not erddap_datasets.empty:
        erddap_datasets = (
            erddap_datasets.set_index(["erddap_url", "dataset_id"])
            .join(df_ckan.set_index(["erddap_url", "dataset_id"]), how="left")
            .reset_index()
        )

        logger.info("Cleaning up ERDDAP data")
        erddap_datasets = erddap_datasets.replace(np.nan, None)

        erddap_datasets["title"] = erddap_datasets["title"].apply(lambda x: unescape_ascii(x))

        erddap_datasets["ckan_title"].fillna(erddap_datasets["title"], inplace=True)

        # prioritize with organizations from CKAN and then pull ERDDAP if needed
        erddap_datasets["organizations"] = erddap_datasets.apply(
            lambda x: x["ckan_organizations"] or unescape_ascii_list(x["organizations"]),
            axis=1,
        )
        del erddap_datasets["title"]
        del erddap_datasets["ckan_organizations"]

        erddap_datasets.rename(
            columns={
                "ckan_title": "title",
                "ckan_title_fr": "title_fr",
            },
            inplace=True,
        )

        erddap_datasets = erddap_datasets.replace(r"\n", " ", regex=True)

        erddap_profiles["depth_min"] = erddap_profiles["depth_min"].fillna(0)
        erddap_profiles["depth_max"] = erddap_profiles["depth_max"].fillna(0)
        erddap_profiles.drop(columns=['altitutde_min', 'altitutde_max'], inplace=True, errors='ignore')

    # --- Merge all sources ---
    datasets = pd.concat([erddap_datasets, obis_datasets], ignore_index=True)
    skipped_datasets = pd.concat([erddap_skipped, obis_skipped], ignore_index=True)

    # Safety net: cde.datasets has NOT NULL on `title` (set_constraints), but
    # upstream metadata occasionally lacks one — an ERDDAP dataset with no
    # title attr + no matching CKAN record, or an OBIS dataset whose metadata
    # fetch returned an empty dict. Without this, the WHOLE harvest rolls
    # back at the final ALTER TABLE step. Fall back to dataset_id (always
    # populated) and log a WARNING so the source data quality issue is
    # visible without blocking ingest.
    _missing_title = datasets["title"].isna() | (
        datasets["title"].astype(str).str.strip() == ""
    )
    if _missing_title.any():
        offenders = datasets.loc[_missing_title, ["erddap_url", "dataset_id"]]
        logger.warning(
            "%d dataset(s) missing title from source metadata; falling back to "
            "dataset_id. Offenders: %s",
            len(offenders),
            offenders.to_dict(orient="records"),
        )
        datasets.loc[_missing_title, "title"] = datasets.loc[
            _missing_title, "dataset_id"
        ]

    # ERDDAP rows don't have obis_nodes — fill with empty lists so the loader's
    # ast.literal_eval doesn't choke on NaN, and so the column exists when only
    # the ERDDAP source is being harvested.
    if "obis_nodes" not in datasets.columns:
        datasets["obis_nodes"] = [[] for _ in range(len(datasets))]
    else:
        datasets["obis_nodes"] = datasets["obis_nodes"].apply(
            lambda x: x if isinstance(x, list) else []
        )

    logger.info("Adding %s datasets, %s profiles, %s obis_cells", len(datasets), len(erddap_profiles), len(obis_cells))

    # Write output CSVs
    datasets.drop_duplicates(["erddap_url", "dataset_id"]).to_csv(
        datasets_file, index=False
    )
    erddap_profiles.drop_duplicates().to_csv(profiles_file, index=False)
    if not df_ckan.empty:
        df_ckan.to_csv(ckan_file, index=False)
    skipped_datasets.drop_duplicates().to_csv(skipped_datasets_file, index=False)

    if not obis_cells.empty:
        obis_cells.to_csv(obis_cells_file, index=False)

    written_files = [datasets_file, profiles_file, skipped_datasets_file]
    if not df_ckan.empty:
        written_files.append(ckan_file)
    logger.info("Wrote %s", " ".join(str(f) for f in written_files))
    if not obis_cells.empty:
        logger.info("Wrote %s (%d cells)", obis_cells_file, len(obis_cells))

    if not skipped_datasets.empty:
        logger.info(
            "skipped %s datasets: %s",
            len(skipped_datasets),
            skipped_datasets["dataset_id"].to_list(),
        )
    return written_files


@monitor(monitor_slug="main-harvester")
def main(erddap_urls, cache_requests, folder, dataset_ids,
         obis_dataset_ids=None, obis_folder=None, obis_geo_filter=None,
         source=None, triggered_by=None):
    logger = _run_logger()
    limit_dataset_ids = None
    if dataset_ids:
        limit_dataset_ids = dataset_ids.split(",")

    # Open a harvest run: one row in cde.harvest_runs, written out as a CSV at
    # the end alongside the existing harvest outputs. Every per-dataset attempt
    # (success / skipped / error) gets stamped with this run_id so the
    # harvest-dashboard service can show history per dataset.
    run_id = str(uuid.uuid4())
    # Tie the run to its Prefect flow run so the dashboard can deep-link to the
    # Prefect UI. None when invoked outside a flow (bare CLI).
    try:
        from prefect.runtime import flow_run as _pf_flow_run
        prefect_flow_run_id = _pf_flow_run.id
    except Exception:
        prefect_flow_run_id = None
    # scope/triggered_source describe whether this is a full harvest or a
    # single-source run, recorded straight from the request so the except
    # handler below always has them even if source resolution raises.
    run_scope = "single" if source else "full"
    triggered_source = source or None
    started_at = datetime.now(timezone.utc)
    git_sha = _resolve_git_sha()
    run_status = "ok"
    run_error_message = None
    erddap_attempts = pd.DataFrame()
    obis_attempts = pd.DataFrame()
    logger.info(
        "Harvest run started: run_id=%s git_sha=%s scope=%s source=%s flow_run=%s",
        run_id, git_sha, run_scope, triggered_source, prefect_flow_run_id,
    )

    try:
        # Submit ERDDAP tasks concurrently using Prefect
        erddap_futures = []
        erddap_urls_list = [u.strip() for u in erddap_urls.split(",") if u.strip()] if erddap_urls else []

        # Single-source narrowing. Resolve BEFORE submitting any task so a bad
        # source hard-fails the run instead of harvesting nothing. OBIS is
        # monolithic, so an OBIS-source run keeps the full obis_dataset_ids
        # list and drops all ERDDAP work, and vice-versa.
        resolved_source = _resolve_source(source, erddap_urls_list)
        if resolved_source == "obis":
            logger.info("Single-source harvest: OBIS only")
            erddap_urls_list = []
        elif resolved_source:
            logger.info("Single-source harvest: %s", resolved_source)
            erddap_urls_list = [resolved_source]
            obis_dataset_ids = None

        for erddap_url in erddap_urls_list:
            logger.info("Submitting harvest task for %s", erddap_url)
            future = harvest_erddap.submit(erddap_url, limit_dataset_ids, cache_requests, run_id=run_id)
            erddap_futures.append(future)

        # Submit OBIS task (runs concurrently with ERDDAP tasks)
        obis_future = None
        if obis_dataset_ids:
            logger.info("Submitting OBIS harvest task for %d datasets", len(obis_dataset_ids))
            obis_cache = obis_folder or os.path.join(os.path.dirname(os.path.abspath(folder)), "obis_cache")
            obis_future = harvest_obis.submit(
                limit_dataset_ids=obis_dataset_ids,
                folder=obis_cache,
                geo_filter=obis_geo_filter,
                run_id=run_id,
            )

        # Wait for all tasks to complete
        logger.info("Waiting for all harvest tasks to complete")
        erddap_results = [f.result() for f in erddap_futures]
        logger.info("All ERDDAP work completed")

        # Collect ERDDAP results
        erddap_profiles = pd.DataFrame()
        erddap_datasets = pd.DataFrame()
        variables = pd.DataFrame()
        erddap_skipped = pd.DataFrame()

        for result in erddap_results:
            erddap_profiles = pd.concat([erddap_profiles, result.profiles])
            erddap_datasets = pd.concat([erddap_datasets, result.datasets])
            variables = pd.concat([variables, result.variables])
            erddap_skipped = pd.concat([erddap_skipped, result.skipped])
            erddap_attempts = pd.concat([erddap_attempts, result.attempts])

        # Collect OBIS results
        obis_cells = pd.DataFrame()
        obis_datasets = pd.DataFrame()
        obis_skipped = pd.DataFrame()
        if obis_future:
            obis_result = obis_future.result()
            obis_cells = obis_result.obis_cells
            obis_datasets = obis_result.datasets
            obis_skipped = obis_result.skipped
            obis_attempts = obis_result.attempts
            logger.info("OBIS harvest completed: %d datasets, %d cells", len(obis_datasets), len(obis_cells))
    except Exception as e:
        run_status = "failed"
        run_error_message = f"{type(e).__name__}: {e}"
        _write_run_audit_csvs(
            folder=folder,
            run_id=run_id,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            git_sha=git_sha,
            status=run_status,
            error_message=run_error_message,
            attempts_frames=[erddap_attempts, obis_attempts],
            logger=logger,
            prefect_flow_run_id=prefect_flow_run_id,
            scope=run_scope,
            triggered_source=triggered_source,
            triggered_by=triggered_by,
        )
        raise

    if not os.path.exists(folder):
        os.makedirs(folder)

    if erddap_datasets.empty and obis_datasets.empty:
        logging.info("No datasets harvested from any source")
        _write_run_audit_csvs(
            folder=folder,
            run_id=run_id,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            git_sha=git_sha,
            status="failed",
            error_message="No datasets harvested from any source",
            attempts_frames=[erddap_attempts, obis_attempts],
            logger=logger,
            prefect_flow_run_id=prefect_flow_run_id,
            scope=run_scope,
            triggered_source=triggered_source,
            triggered_by=triggered_by,
        )
        sys.exit(1)

    # --- ERDDAP-specific post-processing ---
    df_ckan = pd.DataFrame()
    if not erddap_datasets.empty:
        # see what standard names arent covered by our EOVs:
        standard_names_harvested = (
            variables.query("not standard_name.isnull()")["standard_name"].unique().tolist()
        )

        standard_names_not_harvested = [
            x
            for x in standard_names_harvested
            if (x not in supported_standard_names + IGNORED_STANDARD_NAMES) and (not x.startswith("platform_"))
        ]

        standard_names_not_harvested_that_are_real = [
            x for x in standard_names_not_harvested if x in cf_standard_names
        ]

        if standard_names_not_harvested_that_are_real:
            logger.warning(
                "Found these standard_names that CDE doesnt support yet: %s",
                standard_names_not_harvested_that_are_real,
            )

        # query CKAN national for more metadata related to the ERDDAP datsets we have so far
        logger.info("Gathering CKAN data")
        df_ckan = get_ckan_records(erddap_datasets["dataset_id"].to_list(), cache=cache_requests)

    merge_and_write_csvs(
        folder=folder,
        erddap_datasets=erddap_datasets,
        erddap_profiles=erddap_profiles,
        erddap_skipped=erddap_skipped,
        obis_datasets=obis_datasets,
        obis_cells=obis_cells,
        obis_skipped=obis_skipped,
        df_ckan=df_ckan,
    )

    _write_run_audit_csvs(
        folder=folder,
        run_id=run_id,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc),
        git_sha=git_sha,
        status=run_status,
        error_message=run_error_message,
        attempts_frames=[erddap_attempts, obis_attempts],
        logger=logger,
        prefect_flow_run_id=prefect_flow_run_id,
        scope=run_scope,
        triggered_source=triggered_source,
        triggered_by=triggered_by,
    )


def load_config(config_file):
    # get config settings from file, eg harvest_config.yaml
    with open(config_file, "r") as stream:
        try:
            config = yaml.safe_load(stream)
            return config

        except yaml.YAMLError:
            logger.error("Failed to load config yaml", exc_info=True)


def load_obis_dataset_ids(dataset_ids=None, datasets_file=None):
    """Resolve OBIS dataset IDs, loading from JSON file if needed."""
    if dataset_ids:
        return dataset_ids
    if datasets_file:
        with open(datasets_file, "r") as f:
            return json.load(f).get("datasets", [])
    return []


if __name__ == "__main__":

    logger.info("Starting CDE Harvester")
    parser = argparse.ArgumentParser()

    if "-f" in sys.argv or "--file" in sys.argv:
        # Use config file
        parser.add_argument(
            "-f",
            "--file",
            help="get these options from a config file instead",
            required=True,
        )

        args = parser.parse_args()
        config_file = args.file

        config = load_config(config_file)
        logger.info(
            f"Using config from {config_file}, ignoring command line arguments"
        )
        urls = ",".join(config.get("erddap_urls") or [])
        cache = config.get("cache")
        folder = config.get("folder")
        dataset_ids = ",".join(config.get("dataset_ids") or [])
        log_time = config.get("log_time")
        log_level = config.get("log_level", "INFO")
        log_dir = os.environ.get("HARVESTER_LOG_DIR") or config.get("log_dir")
        obis_dataset_ids = load_obis_dataset_ids(
            dataset_ids=config.get("obis_dataset_ids"),
            datasets_file=config.get("obis_datasets_file"),
        )
        obis_folder = config.get("obis_folder")
        geo_cfg = config.get("obis_geo_filter") or {}
        obis_geo_filter = ObisGeoFilter(
            mode=geo_cfg.get("mode", "canada"),
            polygon_file=geo_cfg.get("polygon_file"),
            exempt_node_ids=geo_cfg.get("exempt_node_ids"),
        )

    else:
        logger.info("Using command line arguments")
        parser.add_argument(
            "--urls",
            help="harvest from these erddap servers, comma separated",
            default="",
        )
        parser.add_argument(
            "--dataset_ids",
            help="only harvest these dataset IDs. Comma separated list",
        )

        parser.add_argument(
            "--cache", help="Cache requests, for testing only", action="store_true"
        )

        parser.add_argument(
            "--folder",
            help="Folder to save harvested data to",
            default="harvest",
        )

        parser.add_argument(
            "--log-level",
            default="debug",
            help="Provide logging level. Example --log-level debug, default=debug",
        )
        parser.add_argument(
            "--log-time",
            default=False,
            help="add time to logs",
            action="store_true",
        )
        parser.add_argument(
            "--log-dir",
            default=None,
            help="Directory to save log files to",
        )
        parser.add_argument(
            "--obis-datasets-file",
            default=None,
            help='Path to JSON file with OBIS dataset IDs (format: {"datasets": ["uuid", ...]})',
        )
        parser.add_argument(
            "--obis-dataset-ids",
            default=None,
            help="Comma-separated list of OBIS dataset UUIDs",
        )
        parser.add_argument(
            "--obis-folder",
            default=None,
            help="Cache folder for OBIS occurrence data",
        )
        parser.add_argument(
            "--obis-geo-filter",
            choices=["canada", "none"],
            default="canada",
            help="Geographic filter for OBIS occurrences (default: canada)",
        )
        parser.add_argument(
            "--obis-polygon-file",
            default=None,
            help="Override path to the boundary polygon WKT file",
        )

        args = parser.parse_args()

        log_time = args.log_time
        log_level = args.log_level
        urls = args.urls or ""
        cache = args.cache
        dataset_ids = args.dataset_ids
        folder = args.folder
        log_dir = args.log_dir

        obis_dataset_ids = load_obis_dataset_ids(
            dataset_ids=args.obis_dataset_ids.split(",") if args.obis_dataset_ids else None,
            datasets_file=args.obis_datasets_file,
        )
        obis_folder = args.obis_folder
        obis_geo_filter = ObisGeoFilter(
            mode=args.obis_geo_filter,
            polygon_file=args.obis_polygon_file,
        )

        if not urls and not obis_dataset_ids:
            parser.error("At least one of --urls or --obis-datasets-file/--obis-dataset-ids is required")

    logger = setup_logging(log_time, log_level, log_dir)
    try:
        # main is a plain function now; wrap it in an ad-hoc flow so the
        # standalone CLI still has a flow context (the harvest .submit() tasks
        # need a task runner).
        flow(name="cde-main", log_prints=True)(main)(
            urls, cache, folder or "harvest", dataset_ids,
            obis_dataset_ids=obis_dataset_ids, obis_folder=obis_folder,
            obis_geo_filter=obis_geo_filter)
    except Exception as e:
        logger.error("Harvester failed!!!", exc_info=True)
        raise e
