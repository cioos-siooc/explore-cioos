import os
import queue
import sys
import threading
import time
from pathlib import Path

import click
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
from loguru import logger
from sentry_sdk.crons import monitor
from sentry_sdk.integrations.loguru import LoguruIntegration

load_dotenv()

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[
        LoguruIntegration(),
    ],
    environment=os.environ.get("ENVIRONMENT", "development"),
)


def setup_logging(log_level):
    # setup logging
    logger_format = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<magenta> {extra[erddap_url]} | {extra[dataset_id]} </magenta> | "
        "<cyan>{name}:{function}:{line}</cyan> | "
        "<level>{message}</level>"
    )
    logger.remove()
    logger.configure(
        handlers=[dict(sink=sys.stdout, level=log_level.upper(), format=logger_format)],
        extra={"erddap_url": "", "dataset_id": ""},
    )


def review_standard_names_not_supported(standard_names: list):
    "Create warning for standard names that arent supported by CDE yet"
    llat_variables = ["latitude", "longitude", "time", "depth", ""]

    unsupported_standard_names = [
        x
        for x in standard_names
        if x in cf_standard_names
        and x not in llat_variables
        and x not in supported_standard_names
    ]

    if unsupported_standard_names:
        logger.warning(
            "Found these standard_names that CDE doesnt support yet: {}",
            unsupported_standard_names,
        )


def cleanup_datasets_table(datasets):
    logger.info("Cleaning up data")
    datasets = datasets.replace(np.nan, None)

    # datasets["summary"] = datasets["summary"].apply(lambda x: unescape_ascii(x))
    datasets["title"] = datasets["title"].apply(lambda x: unescape_ascii(x))

    datasets["ckan_title"] = datasets["ckan_title"].fillna(datasets["title"])
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
    return datasets


@monitor(monitor_slug="main-harvester")
def main(erddaps, cache_requests, folder: Path, max_workers: int):

    results = []
    q = queue.Queue()

    def worker():
        while True:
            harvest_erddap(*q.get())
            time.sleep(1)
            q.task_done()

    # Turn-on the worker thread.
    for _ in range(max_workers):
        threading.Thread(target=worker, daemon=True).start()

    # Send thirty task requests to the worker.
    for erddap_conn in erddaps:
        logger.info("Adding to queue {}", erddap_conn["url"])
        q.put((erddap_conn, results, cache_requests))
    q.join()
    logger.info("All work completed")

    all_erddaps_profiles = pd.DataFrame()
    all_erddaps_datasets = pd.DataFrame()
    all_erddaps_variables = pd.DataFrame()
    all_erddaps_skipped_datasets = pd.DataFrame()

    for result in results:
        all_erddaps_profiles = pd.concat([all_erddaps_profiles, result["profiles"]])
        all_erddaps_datasets = pd.concat([all_erddaps_datasets, result["datasets"]])
        all_erddaps_variables = pd.concat([all_erddaps_variables, result["variables"]])
        all_erddaps_skipped_datasets = pd.concat(
            [all_erddaps_skipped_datasets, result["skipped_datasets"]]
        )

    if all_erddaps_datasets.empty:
        logger.info("No datasets harvested")
        sys.exit(1)

    logger.debug("Create output_folder and define output files")
    folder.mkdir(exist_ok=True, parents=True)
    datasets_file = folder / "datasets.csv"
    profiles_file = folder / "profiles.csv"
    skipped_datasets_file = folder / "skipped.csv"
    ckan_file = folder / "ckan.csv"

    # Review standard names that arent supported by CDE
    review_standard_names_not_supported(
        all_erddaps_variables["standard_name"].dropna().unique().tolist()
    )

    # query CKAN national for more metadata related to the ERDDAP datsets we have so far
    logger.info("Gathering CKAN data")
    df_ckan = get_ckan_records(
        all_erddaps_datasets["dataset_id"].to_list(), cache=cache_requests
    )
    datasets = (
        all_erddaps_datasets.set_index(["erddap_url", "dataset_id"])
        .join(df_ckan.set_index(["erddap_url", "dataset_id"]), how="left")
        .reset_index()
    )

    # clean up datasets table
    datasets = cleanup_datasets_table(datasets)

    all_erddaps_profiles["depth_min"] = all_erddaps_profiles["depth_min"].fillna(0.0)
    all_erddaps_profiles["depth_max"] = all_erddaps_profiles["depth_max"].fillna(0.0)

    logger.info(
        "Adding {} datasets and {} profiles", len(datasets), len(all_erddaps_profiles)
    )

    # write files to disk
    logger.info(
        "Writing data to files: {}, {}, {}, {}",
        datasets_file,
        profiles_file,
        ckan_file,
        skipped_datasets_file,
    )
    datasets.drop_duplicates(["erddap_url", "dataset_id"]).to_csv(
        datasets_file, index=False
    )
    all_erddaps_profiles.drop_duplicates().to_csv(profiles_file, index=False)
    df_ckan.to_csv(ckan_file, index=False)
    all_erddaps_skipped_datasets.drop_duplicates().to_csv(
        skipped_datasets_file, index=False
    )
    logger.info("Harvested data saved to files")

    if not all_erddaps_skipped_datasets.empty:
        logger.info(
            "skipped {} datasets: {}",
            len(all_erddaps_skipped_datasets),
            all_erddaps_skipped_datasets["dataset_id"].to_list(),
        )


def load_config(config_file):
    # get config settings from file, eg harvest_config.yaml
    with open(config_file, "r") as stream:
        try:
            config = yaml.safe_load(stream)
            return config

        except yaml.YAMLError:
            logger.error("Failed to load config yaml", exc_info=True)


@click.command()
@click.option(
    "--erddap_urls",
    "--urls",
    help="harvest from these erddap servers, comme separated",
    type=str,
    default=None,
)
@click.option(
    "--dataset_ids",
    help="only harvest these dataset IDs. Comma separated list",
    type=str,
    default="",
)
@click.option(
    "--cache-requests/--no-cache-requests",
    "--cache/--no-cache",
    help="Cache requests, for testing only",
    default=None,
)
@click.option(
    "--cache-requests-status-codes",
    help="Cache requests with these status codes, comma separated list of integers",
    type=str,
    default=None,
)
@click.option(
    "--folder",
    help="Folder to save harvested data to",
    default=Path("harvest"),
    type=click.Path(dir_okay=True, file_okay=False),
)
@click.option(
    "--log-level",
    default="debug",
    type=click.Choice(
        ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"], case_sensitive=False
    ),
    help="Provide logging level. Example --log-level debug, default=debug",
)
@click.option(
    "--max-workers",
    default=1,
    type=int,
    help="max threads that harvester will use",
)
@click.option(
    "-c",
    "--config",
    "-f",
    "--file",
    type=click.Path(exists=True),
    help="get these options from a config file instead",
)
@logger.catch(reraise=True, message="Harvester failed!!!")
def cli(**kwargs):
    """Harvest ERDDAP datasets and profiles and save to CSV files"""
    config = kwargs.pop("config",{})
    cache_requests_status_code = kwargs.pop("cache_requests_status_codes")
    if config:
        config = load_config(config)
    else:
        config = {}
        if erddap_urls := kwargs.pop("erddap_urls"):
            config["erddaps"] = [
                {"url": erddap_url} for erddap_url in erddap_urls.split(",")
            ]
        if dataset_ids := kwargs.pop("dataset_ids"):
            dataset_ids = dataset_ids.split(",")
            for id, _ in enumerate(config["erddaps"]):
                config["erddaps"][id]["dataset_ids"] = dataset_ids
        
        config.update(kwargs)
        cache_requests_status_code = kwargs.pop("cache_requests_status_codes")

        if cache_requests_status_code:
            config["cache_requests"] = [
                int(x) for x in cache_requests_status_code.split(",")
            ]
    setup_logging(config.pop("log_level"))
    main(**config)


if __name__ == "__main__":
    cli()
