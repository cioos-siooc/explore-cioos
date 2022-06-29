import argparse
import logging
import os
import sys
import threading

import numpy as np
import pandas as pd

from erddap_scraper.ckan.create_ckan_erddap_link import get_ckan_records, unescape_ascii
from erddap_scraper.scrape_erddap import scrape_erddap
from erddap_scraper.utils import (
    cf_standard_names,
    df_cde_eov_to_standard_name,
    supported_standard_names,
)

logging.getLogger("urllib3").setLevel(logging.WARNING)


def setup_logging(log_time):
    # setup logging
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    handler = logging.StreamHandler(sys.stdout)

    if log_time:
        format = "%(asctime)s - %(name)s : %(message)s"
    else:
        format = "%(name)s : %(message)s"

    formatter = logging.Formatter(format)

    handler.setFormatter(formatter)
    root.addHandler(handler)


def main(erddap_urls, cache_requests, folder):
    erddap_urls = args.erddap_urls.split(",")
    limit_dataset_ids = None
    if args.dataset_ids:
        limit_dataset_ids = args.dataset_ids.split(",")

    threads = []
    result = []

    for erddap_url in erddap_urls:
        scraping_thread = threading.Thread(
            target=scrape_erddap,
            args=(erddap_url, result, limit_dataset_ids, cache_requests),
        )
        scraping_thread.start()
        threads.append(scraping_thread)

    for thread in threads:
        thread.join()

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
    variables_file = f"{folder}/variables.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    ckan_file = f"{folder}/ckan.csv"

    if datasets.empty:
        print("No datasets scraped")
        return

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

    datasets["summary"] = datasets["summary"].apply(lambda x: unescape_ascii(x))
    datasets["title"] = datasets["title"].apply(lambda x: unescape_ascii(x))

    datasets["ckan_title"].fillna(datasets["title"], inplace=True)
    datasets["ckan_summary"].fillna(datasets["summary"], inplace=True)

    # prioritize with organizations from CKAN and then pull ERDDAP if needed
    datasets["organizations"] = datasets.apply(
        lambda x: x["ckan_organizations"] or x["organizations"], axis=1
    )
    del datasets["title"]
    del datasets["summary"]
    del datasets["ckan_organizations"]

    datasets.rename(
        columns={
            "ckan_title": "title",
            "ckan_title_fr": "title_fr",
            "ckan_summary": "summary",
            "ckan_summary_fr": "summary_fr",
        },
        inplace=True,
    )

    datasets = datasets.replace(r"\n", " ", regex=True)

    profiles["depth_min"] = profiles["depth_min"].fillna(0)
    profiles["depth_max"] = profiles["depth_max"].fillna(0)

    print("Adding", len(datasets), "datasets and", len(profiles), "profiles")

    datasets.to_csv(datasets_file, index=False)
    profiles.to_csv(profiles_file, index=False)
    variables.to_csv(variables_file, index=False)
    df_ckan.to_csv(ckan_file, index=False)
    skipped_datasets.to_csv(skipped_datasets_file, index=False)
    df_cde_eov_to_standard_name.to_csv("df_cde_eov_to_standard_name.csv", index=False)
    print(
        "Wrote",
        datasets_file,
        profiles_file,
        variables_file,
        ckan_file,
        skipped_datasets_file,
    )

    if not skipped_datasets.empty:
        print(
            f"skipped {len(skipped_datasets)} datasets:",
            skipped_datasets["dataset_id"].to_list(),
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("erddap_urls")
    parser.add_argument(
        "--dataset_ids",
        help="only scrape these dataset IDs. Comma separated list",
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
        help="Provide logging level. Example --loglevel debug, default=debug",
    )
    parser.add_argument(
        "--log-time", type=bool, default=False, nargs="?", help="add time to logs"
    )

    args = parser.parse_args()
    setup_logging(args.log_time)

    main(args.erddap_urls, args.cache, args.folder)
