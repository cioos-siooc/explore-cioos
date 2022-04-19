import argparse
import logging
import os
import sys
import threading
import uuid

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from erddap_scraper.ckan.create_ckan_erddap_link import get_ckan_records, unescape_ascii
from erddap_scraper.scrape_erddap import scrape_erddap
from erddap_scraper.utils import (
    get_df_eov_to_standard_names,
    supported_standard_names,
    cf_standard_names,
)
from sqlalchemy import create_engine

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


def main(erddap_urls, csv_only, cache_requests):
    # setup database connection
    # This is only run from outside docker
    if not csv_only:
        load_dotenv(os.getcwd() + "/.env")

        envs = os.environ

        database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"

        engine = create_engine(database_link)
        # test connection
        engine.connect()
        print("Connected to ", envs["DB_HOST_EXTERNAL"])

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

    datasets_not_added_total = []

    for [profile, dataset, datasets_not_added, variable, skipped_dataset] in result:
        profiles = pd.concat([profiles, profile])
        datasets = pd.concat([datasets, dataset])
        datasets_not_added_total = datasets_not_added_total + datasets_not_added
        variables = pd.concat([variables, variable])
        skipped_datasets = pd.concat([skipped_datasets, skipped_dataset])

    uuid_suffix = str(uuid.uuid4())[0:6]
    datasets_file = f"datasets_{uuid_suffix}.csv"
    profiles_file = f"profiles_{uuid_suffix}.csv"
    variables_file = f"variables_{uuid_suffix}.csv"
    skipped_datasets_file = f"skipped_{uuid_suffix}.csv"
    ckan_file = f"ckan_{uuid_suffix}.csv"

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
            "Found these standard_names that CEDA doesnt support yet:\n",
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
    if csv_only:
        datasets.to_csv(datasets_file, index=False)
        profiles.to_csv(profiles_file, index=False)
        variables.to_csv(variables_file, index=False)
        df_ckan.to_csv(ckan_file, index=False)
        skipped_datasets.to_csv(skipped_datasets_file, index=False)
        print(
            "Wrote",
            datasets_file,
            profiles_file,
            variables_file,
            ckan_file,
            skipped_datasets_file,
        )
    else:
        schema = "cioos_api"
        with engine.begin() as transaction:
            print("Writing to DB:")
            print("Clearing tables")
            transaction.execute("SELECT remove_all_data();")

            print("Writing datasets")

            datasets.to_sql(
                "datasets",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            profiles = profiles.replace("", np.NaN)

            print("Writing profiles")

            profiles.to_sql(
                "profiles",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )
            variables = variables.replace("", np.NaN)

            print("Writing erddap_variables")
            variables.to_sql(
                "erddap_variables",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            print("Writing skipped_datasets")
            variables.to_sql(
                "skipped_datasets",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            print("Writing eov_to_standard_name")
            get_df_eov_to_standard_names().to_sql(
                "eov_to_standard_name",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            print("Processing new records")
            transaction.execute("SELECT profile_process();")
            transaction.execute("SELECT ckan_process();")

            print("Creating hexes")
            transaction.execute("SELECT create_hexes();")

        print("Wrote to db:", f"{schema}.datasets")
        print("Wrote to db:", f"{schema}.profiles")
        print("Wrote to db:", f"{schema}.erddap_variables")

    print(
        f"skipped {len(datasets_not_added_total)} datasets:", datasets_not_added_total
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("erddap_urls")
    parser.add_argument(
        "--dataset_ids",
        help="only scrape these dataset IDs. Comma separated list",
    )
    parser.add_argument(
        "--csv-only", help="Skip writing to the DB", action="store_true"
    )
    parser.add_argument(
        "--cache", help="Cache requests, for testing only", action="store_true"
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

    main(args.erddap_urls, args.csv_only, args.cache)
