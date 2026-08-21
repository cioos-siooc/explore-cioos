import argparse
import logging
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from cde_harvester.sources.ckan.create_ckan_erddap_link import (
    get_ckan_records,
    unescape_ascii,
    unescape_ascii_list,
)
from cde_harvester.core.config import load_config, load_obis_dataset_ids
from cde_harvester.sources import resolve_source
from cde_harvester.core.observability import (
    cleanup_old_logs,
    init_sentry,
    setup_logging,
)
from cde_harvester.core.schemas import HarvestAttemptSchema
from cde_harvester.sources.erddap.harvester import harvest_erddap
from cde_harvester.sources.obis.geo_filter import ObisGeoFilter
from cde_harvester.sources.obis.harvester import harvest_obis
from cde_harvester.utils import cf_standard_names, supported_standard_names
from dotenv import load_dotenv
from sentry_sdk.crons import monitor
from prefect import flow, get_run_logger, task

load_dotenv()

logging.getLogger("urllib3").setLevel(logging.WARNING)
logger = logging.getLogger()

init_sentry()

# Ignored standard names that are not EOVs, mostly coordinate variables
IGNORED_STANDARD_NAMES= ["latitude", "longitude", "time", "depth", "","altitude","sea_water_pressure","sea_water_pressure_due_to_sea_water"]

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
                         obis_datasets, obis_cells, obis_skipped, df_ckan,
                         erddap_verified=None, erddap_trajectory_days=None,
                         erddap_trajectory_points=None):
    """Join CKAN metadata, merge all sources, and write the output CSVs (@task)."""
    logger = _run_logger()
    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    ckan_file = f"{folder}/ckan.csv"
    obis_cells_file = f"{folder}/obis_cells.csv"
    trajectory_days_file = f"{folder}/trajectory_days.csv"
    trajectory_points_file = f"{folder}/trajectory_points.csv"
    verified_file = f"{folder}/verified.csv"

    if erddap_trajectory_days is None:
        erddap_trajectory_days = pd.DataFrame()
    if erddap_trajectory_points is None:
        erddap_trajectory_points = pd.DataFrame()

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

    # Safety net: title is a required column on cde.datasets (checked by
    # validate_loaded_data()), but upstream metadata occasionally lacks one — an
    # ERDDAP dataset with no title attr + no matching CKAN record, or an OBIS
    # dataset whose metadata fetch returned an empty dict. Without this, the WHOLE
    # harvest rolls back at the final validation step. Fall back to dataset_id
    # (always populated) and log a WARNING so the source data quality issue is
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

    logger.info(
        "Adding %s datasets, %s profiles, %s obis_cells, %s trajectory_days, "
        "%s trajectory_points",
        len(datasets), len(erddap_profiles), len(obis_cells),
        len(erddap_trajectory_days), len(erddap_trajectory_points),
    )

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

    if not erddap_trajectory_days.empty:
        erddap_trajectory_days.to_csv(trajectory_days_file, index=False)

    if not erddap_trajectory_points.empty:
        erddap_trajectory_points.to_csv(trajectory_points_file, index=False)

    # Datasets skipped as unchanged — only their verified_at is bumped by the loader.
    if erddap_verified is not None and not erddap_verified.empty:
        erddap_verified.drop_duplicates(["erddap_url", "dataset_id"]).to_csv(
            verified_file, index=False
        )
        logger.info("Wrote %s (%d unchanged datasets)", verified_file, len(erddap_verified))

    written_files = [datasets_file, profiles_file, skipped_datasets_file]
    if not df_ckan.empty:
        written_files.append(ckan_file)
    logger.info("Wrote %s", " ".join(str(f) for f in written_files))
    if not obis_cells.empty:
        logger.info("Wrote %s (%d cells)", obis_cells_file, len(obis_cells))
    if not erddap_trajectory_days.empty:
        logger.info(
            "Wrote %s (%d days)", trajectory_days_file, len(erddap_trajectory_days)
        )
    if not erddap_trajectory_points.empty:
        logger.info(
            "Wrote %s (%d track points)",
            trajectory_points_file, len(erddap_trajectory_points),
        )

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
         source=None, triggered_by=None, skip_unchanged=False):
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
    erddap_verified = pd.DataFrame()
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
        resolved_source = resolve_source(source, erddap_urls_list)
        if resolved_source == "obis":
            logger.info("Single-source harvest: OBIS only")
            erddap_urls_list = []
        elif resolved_source:
            logger.info("Single-source harvest: %s", resolved_source)
            erddap_urls_list = [resolved_source]
            obis_dataset_ids = None

        for erddap_url in erddap_urls_list:
            logger.info("Submitting harvest task for %s", erddap_url)
            future = harvest_erddap.submit(erddap_url, limit_dataset_ids, cache_requests, run_id=run_id, skip_unchanged=skip_unchanged)
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
        erddap_trajectory_days = pd.DataFrame()
        erddap_trajectory_points = pd.DataFrame()
        erddap_datasets = pd.DataFrame()
        variables = pd.DataFrame()
        erddap_skipped = pd.DataFrame()

        for result in erddap_results:
            erddap_profiles = pd.concat([erddap_profiles, result.profiles])
            erddap_trajectory_days = pd.concat(
                [erddap_trajectory_days, result.trajectory_days]
            )
            erddap_trajectory_points = pd.concat(
                [erddap_trajectory_points, result.trajectory_points]
            )
            erddap_datasets = pd.concat([erddap_datasets, result.datasets])
            variables = pd.concat([variables, result.variables])
            erddap_skipped = pd.concat([erddap_skipped, result.skipped])
            erddap_attempts = pd.concat([erddap_attempts, result.attempts])
            erddap_verified = pd.concat([erddap_verified, result.verified])

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

    # Empty erddap_datasets/obis_datasets is NOT a failure when skip_unchanged
    # caching is on and every dataset hashed unchanged: those rows live in
    # erddap_verified and still need their verified_at bumped via
    # merge_and_write_csvs below. Only a run that harvested nothing AND verified
    # nothing genuinely had no datasets to process.
    if erddap_datasets.empty and obis_datasets.empty and erddap_verified.empty:
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
        # Raise, don't sys.exit: main() also runs INSIDE a Prefect flow, where
        # SystemExit reports as "Crashed" (no message, no failure handling)
        # instead of a clean Failed. The CLI path still exits non-zero on an
        # uncaught exception.
        raise RuntimeError("No datasets harvested from any source")

    if erddap_datasets.empty and obis_datasets.empty:
        logging.info(
            "No new/changed datasets to harvest; %d unchanged datasets to verify",
            len(erddap_verified),
        )

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
        # .submit() + wait_for (instead of a direct call) so the Prefect flow
        # graph draws the real pipeline order: harvest -> fetch-ckan -> merge.
        # The futures are already resolved, so this adds no waiting.
        df_ckan = get_ckan_records.submit(
            erddap_datasets["dataset_id"].to_list(), cache=cache_requests,
            wait_for=erddap_futures,
        )

    # df_ckan may be a future; Prefect resolves it (and draws the edge) on submit.
    merge_and_write_csvs.submit(
        folder=folder,
        erddap_datasets=erddap_datasets,
        erddap_profiles=erddap_profiles,
        erddap_trajectory_days=erddap_trajectory_days,
        erddap_trajectory_points=erddap_trajectory_points,
        erddap_skipped=erddap_skipped,
        obis_datasets=obis_datasets,
        obis_cells=obis_cells,
        obis_skipped=obis_skipped,
        df_ckan=df_ckan,
        erddap_verified=erddap_verified,
        wait_for=[f for f in [*erddap_futures, obis_future] if f is not None],
    ).result()

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


if __name__ == "__main__":

    logger.info("Starting CDE Harvester")
    parser = argparse.ArgumentParser()

    # Determine if config file should be used
    config_file_env = os.environ.get("HARVEST_CONFIG_FILE")
    use_config_file = "-f" in sys.argv or "--file" in sys.argv or config_file_env is not None

    if use_config_file:
        # Use config file (from command line arg, env var, or default)
        parser.add_argument(
            "-f",
            "--file",
            help="get these options from a config file instead",
            required=False,
        )

        args = parser.parse_args()
        config_file = args.file or config_file_env

        if not config_file:
            parser.error("Config file must be provided via -f/--file flag or HARVEST_CONFIG_FILE environment variable")

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
