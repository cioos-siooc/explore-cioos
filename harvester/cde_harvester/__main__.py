import argparse
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
from cde_harvester.harvest_erddap import harvest_erddap
from cde_harvester.utils import cf_standard_names, supported_standard_names
from dotenv import load_dotenv
from sentry_sdk.crons import monitor
from sentry_sdk.integrations.logging import LoggingIntegration

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


@monitor(monitor_slug="main-harvester")
def main(erddap_urls, cache_requests, folder, dataset_ids, max_workers):
    erddap_urls = erddap_urls.split(",")
    limit_dataset_ids = None
    if dataset_ids:
        limit_dataset_ids = dataset_ids.split(",")

    result = []

    q = queue.Queue()

    def worker():
        while True:
            (erddap_url, result, limit_dataset_ids, cache_requests) = q.get()
            harvest_erddap(erddap_url, result, limit_dataset_ids, cache_requests)
            time.sleep(1)
            q.task_done()

    # Turn-on the worker thread.
    for x in range(max_workers):
        threading.Thread(target=worker, daemon=True).start()

    # Send thirty task requests to the worker.

    for erddap_url in erddap_urls:
        logger.info("Adding to queue %s", erddap_url)
        q.put((erddap_url, result, limit_dataset_ids, cache_requests))

    q.join()
    logger.info("All work completed")

    profiles = pd.DataFrame()
    datasets = pd.DataFrame()
    variables = pd.DataFrame()
    skipped_datasets = pd.DataFrame()

    for [profile, dataset, variable, skipped_dataset] in result:
        profiles = pd.concat([profiles, profile])
        datasets = pd.concat([datasets, dataset])
        variables = pd.concat([variables, variable])
        skipped_datasets = pd.concat([skipped_datasets, skipped_dataset])

    if not os.path.exists(folder):
        os.makedirs(folder)

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    ckan_file = f"{folder}/ckan.csv"

    if datasets.empty:
        logging.info("No datasets harvested")
        sys.exit(1)

    # see what standard names arent covered by our EOVs:
    standard_names_harvested = (
        variables.query("not standard_name.isnull()")["standard_name"].unique().tolist()
    )

    # this gets a list of all the standard names

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
    df_ckan = get_ckan_records(datasets["dataset_id"].to_list(), cache=cache_requests)
    datasets = (
        datasets.set_index(["erddap_url", "dataset_id"])
        .join(df_ckan.set_index(["erddap_url", "dataset_id"]), how="left")
        .reset_index()
    )

    logger.info("Cleaning up data")
    datasets = datasets.replace(np.nan, None)

    # datasets["summary"] = datasets["summary"].apply(lambda x: unescape_ascii(x))
    datasets["title"] = datasets["title"].apply(lambda x: unescape_ascii(x))

    datasets["ckan_title"].fillna(datasets["title"], inplace=True)
    # datasets["ckan_summary"].fillna(datasets["summary"], inplace=True)

    # prioritize with organizations from CKAN and then pull ERDDAP if needed
    datasets["organizations"] = datasets.apply(
        lambda x: x["ckan_organizations"] or unescape_ascii_list(x["organizations"]),
        axis=1,
    )
    del datasets["title"]
    # del datasets["summary"]
    del datasets["ckan_organizations"]

    datasets.rename(
        columns={
            "ckan_title": "title",
            "ckan_title_fr": "title_fr",
            # "ckan_summary": "summary",
            # "ckan_summary_fr": "summary_fr",
        },
        inplace=True,
    )

    datasets = datasets.replace(r"\n", " ", regex=True)

    profiles["depth_min"] = profiles["depth_min"].fillna(0)
    profiles["depth_max"] = profiles["depth_max"].fillna(0)
    profiles.drop(columns=['altitutde_min', 'altitutde_max'], inplace=True, errors='ignore')

    logger.info("Adding %s datasets and %s profiles", len(datasets), len(profiles))

    # drop duplicates caused by EDDTableFromErddap redirects
    datasets.drop_duplicates(["erddap_url", "dataset_id"]).to_csv(
        datasets_file, index=False
    )
    profiles.drop_duplicates().to_csv(profiles_file, index=False)
    df_ckan.to_csv(ckan_file, index=False)
    skipped_datasets.drop_duplicates().to_csv(skipped_datasets_file, index=False)

    logger.info(
        "Wrote %s %s %s %s",
        datasets_file,
        profiles_file,
        ckan_file,
        skipped_datasets_file,
    )

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


if __name__ == "__main__":

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
        max_workers = config.get("max-workers", 1)
        dataset_ids = ",".join(config.get("dataset_ids") or [])
        log_time = config.get("log_time")
        log_level = config.get("log_level", "INFO")
        log_dir = os.environ.get("HARVESTER_LOG_DIR") or config.get("log_dir")

    else:
        logger.info("Using command line arguments")
        parser.add_argument(
            "--urls",
            help="harvest from these erddap servers, comme separated",
            required=True,
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
            "--max-workers",
            default=1,
            help="max threads that harvester will use",
        )
        parser.add_argument(
            "--log-dir",
            default=None,
            help="Directory to save log files to",
        )

        args = parser.parse_args()

        log_time = args.log_time
        log_level = args.log_level
        urls = args.urls or ""
        cache = args.cache
        dataset_ids = args.dataset_ids
        max_workers = args.max_workers
        folder = args.folder
        log_dir = args.log_dir

    logger = setup_logging(log_time, log_level, log_dir)
    try:
        main(urls, cache, folder or "harvest", dataset_ids, max_workers)
    except Exception as e:
        logger.error("Harvester failed!!!", exc_info=True)
        raise e
