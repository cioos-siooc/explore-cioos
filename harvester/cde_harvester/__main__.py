import argparse
import os
import queue
import sys
import threading
import time

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
        logger.info("Adding to queue {}", erddap_url)
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
        logger.info("No datasets harvested")
        sys.exit(1)

    # see what standard names arent covered by our EOVs:
    standard_names_harvested = (
        variables.query("not standard_name.isnull()")["standard_name"].unique().tolist()
    )

    llat_variables = ["latitude", "longitude", "time", "depth", ""]

    # this gets a list of all the standard names

    standard_names_not_harvested = [
        x
        for x in standard_names_harvested
        if x not in supported_standard_names + llat_variables
    ]

    standard_names_not_harvested_that_are_real = [
        x for x in standard_names_not_harvested if x in cf_standard_names
    ]

    if standard_names_not_harvested_that_are_real:
        logger.warning(
            "Found these standard_names that CDE doesnt support yet: {}",
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

    profiles["depth_min"] = profiles["depth_min"].fillna(0.0)
    profiles["depth_max"] = profiles["depth_max"].fillna(0.0)

    logger.info("Adding %s datasets and %s profiles", len(datasets), len(profiles))

    # drop duplicates caused by EDDTableFromErddap redirects
    datasets.drop_duplicates(["erddap_url", "dataset_id"]).to_csv(
        datasets_file, index=False
    )
    profiles.drop_duplicates().to_csv(profiles_file, index=False)
    df_ckan.to_csv(ckan_file, index=False)
    skipped_datasets.drop_duplicates().to_csv(skipped_datasets_file, index=False)

    logger.info(
        "Wrote {} {} {} {}",
        datasets_file,
        profiles_file,
        ckan_file,
        skipped_datasets_file,
    )

    if not skipped_datasets.empty:
        logger.info(
            "skipped {} datasets: {}",
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


@click.command()
@click.option(
    "--erddap_urls",
    "--urls",
    help="harvest from these erddap servers, comme separated",
    type=str,
    required=True,
)
@click.option(
    "--dataset_ids",
    help="only harvest these dataset IDs. Comma separated list",
    type=str,
    default="",
)
@click.option(
    "--cache-requests", "--cache", help="Cache requests, for testing only", is_flag=True
)
@click.option(
    "--folder",
    help="Folder to save harvested data to",
    default="harvest",
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
    config = kwargs.pop("config")
    if config:
        kwargs.update(load_config(config))
    setup_logging(kwargs.pop("log_level"))
    main(**kwargs)


if __name__ == "__main__":
    cli()
