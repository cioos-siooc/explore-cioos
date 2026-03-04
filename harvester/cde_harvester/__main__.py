import logging
import os
import time
from datetime import datetime
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
from cde_harvester.harvest_erddap import check_dataset, fetch_profiles, prepare_server
from cde_harvester.utils import cf_standard_names, supported_standard_names
from dotenv import load_dotenv
from sentry_sdk.integrations.logging import LoggingIntegration
from prefect import flow, get_run_logger, task

load_dotenv()

logging.getLogger("urllib3").setLevel(logging.WARNING)
logger = logging.getLogger()

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[
        LoggingIntegration(
            level=logging.INFO,
            event_level=logging.WARNING,
        ),
    ],
    environment=os.environ.get("ENVIRONMENT", "development"),
)

IGNORED_STANDARD_NAMES = [
    "latitude", "longitude", "time", "depth", "", "altitude",
    "sea_water_pressure", "sea_water_pressure_due_to_sea_water",
]


def setup_logging(log_time, log_level, log_dir=None):
    if log_dir:
        _cleanup_old_logs(log_dir, days=30)

    logger.setLevel(logging.getLevelName(log_level.upper()))
    logger.handlers.clear()

    log_format = (
        ("%(asctime)s - " if log_time else "")
        + "%(levelname)-8s - %(name)s : %(message)s"
    )

    c_handler = logging.StreamHandler()
    c_handler.setLevel(logging.getLevelName(log_level.upper()))
    c_handler.setFormatter(logging.Formatter(log_format))
    logger.addHandler(c_handler)

    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = os.path.join(log_dir, f"harvest_{timestamp}.log")
        f_handler = logging.FileHandler(log_file)
        f_handler.setLevel(logging.getLevelName(log_level.upper()))
        f_handler.setFormatter(
            logging.Formatter("%(asctime)s - %(levelname)-8s - %(name)s : %(message)s")
        )
        logger.addHandler(f_handler)
        logger.info(f"Logging to file: {log_file}")

    return logger


def _cleanup_old_logs(log_dir, days=30):
    if not os.path.exists(log_dir):
        return
    cutoff_time = time.time() - (days * 86400)
    removed = 0
    for filename in os.listdir(log_dir):
        if filename.startswith("harvest_") and filename.endswith(".log"):
            filepath = os.path.join(log_dir, filename)
            if os.path.isfile(filepath) and os.path.getmtime(filepath) < cutoff_time:
                try:
                    os.remove(filepath)
                    removed += 1
                except OSError as e:
                    logger.warning("Failed to remove old log %s: %s", filename, e)
    if removed:
        logger.info("Cleaned up %d log file(s) older than %d days", removed, days)


def load_config(config_file):
    with open(config_file, "r") as stream:
        try:
            return yaml.safe_load(stream)
        except yaml.YAMLError:
            logger.error("Failed to load config yaml", exc_info=True)


@task(task_run_name="process-server-data-{erddap_url}")
def process_server_data(erddap_url, profiles, datasets, variables, skipped, folder, cache_requests):
    """
    Run CKAN lookup, clean up data, and write per-server CSV files.
    Returns the server-specific output folder path.
    """
    task_logger = get_run_logger()
    hostname = urlparse(erddap_url).hostname
    server_folder = os.path.join(folder, hostname)
    os.makedirs(server_folder, exist_ok=True)

    if datasets.empty:
        task_logger.info("No datasets harvested for %s", erddap_url)
        skipped.drop_duplicates().to_csv(f"{server_folder}/skipped.csv", index=False)
        return server_folder

    # Log unsupported standard names
    if not variables.empty:
        harvested_names = (
            variables.query("not standard_name.isnull()")["standard_name"].unique().tolist()
        )
        unsupported = [
            x for x in harvested_names
            if x not in supported_standard_names + IGNORED_STANDARD_NAMES
            and not x.startswith("platform_")
        ]
        real_unsupported = [x for x in unsupported if x in cf_standard_names]
        if real_unsupported:
            task_logger.warning(
                "Standard names not yet supported by CDE: %s", real_unsupported
            )

    # CKAN lookup for this server's datasets
    task_logger.info("Gathering CKAN data for %s", erddap_url)
    df_ckan = get_ckan_records(datasets["dataset_id"].tolist(), cache=cache_requests)

    datasets = (
        datasets.set_index(["erddap_url", "dataset_id"])
        .join(df_ckan.set_index(["erddap_url", "dataset_id"]), how="left")
        .reset_index()
    )

    datasets = datasets.replace(np.nan, None)
    datasets["title"] = datasets["title"].apply(lambda x: unescape_ascii(x))
    datasets["ckan_title"].fillna(datasets["title"], inplace=True)
    datasets["organizations"] = datasets.apply(
        lambda x: x["ckan_organizations"] or unescape_ascii_list(x["organizations"]),
        axis=1,
    )
    del datasets["title"]
    del datasets["ckan_organizations"]
    datasets.rename(
        columns={"ckan_title": "title", "ckan_title_fr": "title_fr"},
        inplace=True,
    )
    datasets = datasets.replace(r"\n", " ", regex=True)

    profiles["depth_min"] = profiles["depth_min"].fillna(0)
    profiles["depth_max"] = profiles["depth_max"].fillna(0)
    profiles.drop(columns=["altitutde_min", "altitutde_max"], inplace=True, errors="ignore")

    task_logger.info(
        "Writing %d datasets and %d profiles for %s",
        len(datasets), len(profiles), erddap_url,
    )

    datasets.drop_duplicates(["erddap_url", "dataset_id"]).to_csv(
        f"{server_folder}/datasets.csv", index=False
    )
    profiles.drop_duplicates().to_csv(f"{server_folder}/profiles.csv", index=False)
    df_ckan.to_csv(f"{server_folder}/ckan.csv", index=False)
    skipped.drop_duplicates().to_csv(f"{server_folder}/skipped.csv", index=False)

    if not skipped.empty:
        task_logger.info(
            "Skipped %d datasets: %s", len(skipped), skipped["dataset_id"].tolist()
        )

    return server_folder


@task(task_run_name="upload-to-db-{server_folder}")
def upload_to_db(server_folder):
    """Upload harvested data for one ERDDAP server to the database (incremental/UPSERT)."""
    from cde_db_loader.__main__ import upload_server_data
    upload_server_data(server_folder, incremental=True)


@flow(name="harvest-server", flow_run_name="harvest-{erddap_url}")
def harvest_server_flow(erddap_url, folder, cache_requests, dataset_ids):
    """
    Prefect subflow for one ERDDAP server:
      1. prepare_server    — fetch dataset list (one allDatasets.csv call)
      2. For each dataset (sequential):
           check_dataset   — compliance check
           fetch_profiles  — profile min/max/count queries + dataset metadata
      3. process_server_data — CKAN lookup, cleanup, write CSVs
      4. upload_to_db        — incremental upsert into PostgreSQL
    """
    flow_logger = get_run_logger()
    flow_logger.info("Starting harvest for %s", erddap_url)

    limit_dataset_ids = dataset_ids.split(",") if dataset_ids else None

    dataset_ids_list, initial_skipped = prepare_server(erddap_url, limit_dataset_ids, cache_requests)

    if not dataset_ids_list:
        flow_logger.warning("No datasets to harvest for %s", erddap_url)
        return

    flow_logger.info("Harvesting %d datasets for %s", len(dataset_ids_list), erddap_url)

    profiles_list = []
    datasets_list = []
    variables_list = []
    skipped_list = [initial_skipped]

    for did in dataset_ids_list:
        passed, skipped_df = check_dataset(erddap_url, did, cache_requests)
        if not passed:
            skipped_list.append(skipped_df)
            continue
        profiles_df, dataset_df, variables_df = fetch_profiles(erddap_url, did, cache_requests)
        profiles_list.append(profiles_df)
        datasets_list.append(dataset_df)
        variables_list.append(variables_df)

    profiles = pd.concat(profiles_list, ignore_index=True)
    datasets = pd.concat(datasets_list, ignore_index=True)
    variables = pd.concat(variables_list, ignore_index=True)
    skipped = pd.concat(skipped_list, ignore_index=True)

    server_folder = process_server_data(
        erddap_url, profiles, datasets, variables, skipped, folder, cache_requests
    )

    upload_to_db(server_folder)

    flow_logger.info("Completed harvest for %s", erddap_url)
