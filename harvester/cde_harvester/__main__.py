import argparse
import json
import logging
import os
import queue
import sys
import threading
import time
from datetime import datetime

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
from cde_harvester.obis_harvester import harvest_obis
from cde_harvester.utils import cf_standard_names, supported_standard_names
from dotenv import load_dotenv
from sentry_sdk.crons import monitor
from sentry_sdk.integrations.logging import LoggingIntegration
from prefect import flow, get_run_logger

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

@flow(name="cde-main", log_prints=True)
@monitor(monitor_slug="main-harvester")
def main(erddap_urls, cache_requests, folder, dataset_ids,
         obis_dataset_ids=None, obis_folder=None):
    logger = get_run_logger()
    limit_dataset_ids = None
    if dataset_ids:
        limit_dataset_ids = dataset_ids.split(",")

    # Submit ERDDAP tasks concurrently using Prefect
    erddap_futures = []
    erddap_urls_list = [u.strip() for u in erddap_urls.split(",") if u.strip()] if erddap_urls else []
    for erddap_url in erddap_urls_list:
        logger.info("Submitting harvest task for %s", erddap_url)
        future = harvest_erddap.submit(erddap_url, limit_dataset_ids, cache_requests)
        erddap_futures.append(future)

    # Submit OBIS task (runs concurrently with ERDDAP tasks)
    obis_future = None
    if obis_dataset_ids:
        logger.info("Submitting OBIS harvest task for %d datasets", len(obis_dataset_ids))
        obis_cache = obis_folder or os.path.join(os.path.dirname(os.path.abspath(folder)), "obis_cache")
        obis_future = harvest_obis.submit(limit_dataset_ids=obis_dataset_ids, folder=obis_cache)

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

    # Collect OBIS results
    obis_cells = pd.DataFrame()
    obis_datasets = pd.DataFrame()
    obis_skipped = pd.DataFrame()
    if obis_future:
        obis_result = obis_future.result()
        obis_cells = obis_result.obis_cells
        obis_datasets = obis_result.datasets
        obis_skipped = obis_result.skipped
        logger.info("OBIS harvest completed: %d datasets, %d cells", len(obis_datasets), len(obis_cells))

    if not os.path.exists(folder):
        os.makedirs(folder)

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    ckan_file = f"{folder}/ckan.csv"
    obis_cells_file = f"{folder}/obis_cells.csv"

    if erddap_datasets.empty and obis_datasets.empty:
        logging.info("No datasets harvested from any source")
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

    logger.info(
        "Wrote %s %s %s %s",
        datasets_file,
        profiles_file,
        ckan_file,
        skipped_datasets_file,
    )
    if not obis_cells.empty:
        logger.info("Wrote %s (%d cells)", obis_cells_file, len(obis_cells))

    if not skipped_datasets.empty:
        logger.info(
            "skipped %s datasets: %s",
            len(skipped_datasets),
            skipped_datasets["dataset_id"].to_list(),
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

        if not urls and not obis_dataset_ids:
            parser.error("At least one of --urls or --obis-datasets-file/--obis-dataset-ids is required")

    logger = setup_logging(log_time, log_level, log_dir)
    try:
        main(urls, cache, folder or "harvest", dataset_ids,
             obis_dataset_ids=obis_dataset_ids, obis_folder=obis_folder)
    except Exception as e:
        logger.error("Harvester failed!!!", exc_info=True)
        raise e
