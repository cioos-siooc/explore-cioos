import argparse
import logging
import os
import queue
import sys
import threading
import time

import numpy as np
import pandas as pd
import yaml
from cde_harvester.ckan.create_ckan_erddap_link import (
    get_ckan_records,
    unescape_ascii,
    unescape_ascii_list,
)
from cde_harvester.harvest_erddap import harvest_erddap
from cde_harvester.utils import cf_standard_names, supported_standard_names

logging.getLogger("urllib3").setLevel(logging.WARNING)


def setup_logging(log_time, log_level):
    # setup logging
    print(log_time, log_level)
    root = logging.getLogger()

    root.setLevel(getattr(logging, (log_level or "DEBUG").upper()))
    handler = logging.StreamHandler(sys.stdout)

    if log_time:
        format = "%(asctime)s - %(name)s : %(message)s"
    else:
        format = "%(name)s : %(message)s"

    formatter = logging.Formatter(format)

    handler.setFormatter(formatter)
    root.addHandler(handler)


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
        print("Adding to queue", erddap_url)
        q.put((erddap_url, result, limit_dataset_ids, cache_requests))

    q.join()
    print("All work completed")

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
        print("No datasets harvested")
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
        print(
            "Found these standard_names that CDE doesnt support yet:\n",
            standard_names_not_harvested_that_are_real,
        )

    # query CKAN national for more metadata related to the ERDDAP datsets we have so far
    print("Gathering CKAN data")
    df_ckan = get_ckan_records(datasets["dataset_id"].to_list(), cache=cache_requests)
    datasets = (
        datasets.set_index(["erddap_url", "dataset_id"])
        .join(df_ckan.set_index(["erddap_url", "dataset_id"]), how="left")
        .reset_index()
    )

    print("Cleaning up data")
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

    print("Adding", len(datasets), "datasets and", len(profiles), "profiles")

    # drop duplicates caused by EDDTableFromErddap redirects
    datasets.drop_duplicates(["erddap_url", "dataset_id"]).to_csv(
        datasets_file, index=False
    )
    profiles.drop_duplicates().to_csv(profiles_file, index=False)
    df_ckan.to_csv(ckan_file, index=False)
    skipped_datasets.drop_duplicates().to_csv(skipped_datasets_file, index=False)

    print(
        "Wrote",
        datasets_file,
        profiles_file,
        ckan_file,
        skipped_datasets_file,
    )

    if not skipped_datasets.empty:
        print(
            f"skipped {len(skipped_datasets)} datasets:",
            skipped_datasets["dataset_id"].to_list(),
        )


def load_config(config_file):
    # get config settings from file, eg harvest_config.yaml
    with open(config_file, "r") as stream:
        try:
            config = yaml.safe_load(stream)
            return config

        except yaml.YAMLError as exc:
            print(exc)


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
        print("Using config from harvest_config.yaml, ignoring command line arguments")
        urls = ",".join(config.get("erddap_urls") or [])
        cache = config.get("cache")
        folder = config.get("folder")
        max_workers = config.get("max-workers", 1)
        dataset_ids = ",".join(config.get("dataset_ids") or [])
        log_time = config.get("log_time")
        log_level = config.get("log_level")

    else:
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

        args = parser.parse_args()

        log_time = args.log_time
        log_level = args.log_level
        urls = args.urls or ""
        cache = args.cache
        dataset_ids = args.dataset_ids
        max_workers = args.max_workers
        folder = args.folder

    setup_logging(log_time, log_level)

    main(urls, cache, folder or "harvest", dataset_ids, max_workers)
