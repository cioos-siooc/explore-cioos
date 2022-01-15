import argparse
import logging
import os
import sys
import threading
import uuid

import pandas as pd
from ckan_scraper.create_ckan_erddap_link import get_ckan_records
from dotenv import load_dotenv
from sqlalchemy import create_engine

from erddap_scraper.scrape_erddap import scrape_erddap
from erddap_scraper.utils import outersection, supported_standard_names

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

    datasets_not_added_total = []

    for [profile, dataset, datasets_not_added, variable] in result:
        profiles = profiles.append(profile)
        datasets = datasets.append(dataset)
        datasets_not_added_total = datasets_not_added_total + datasets_not_added
        variables = variables.append(variable)

    uuid_suffix = str(uuid.uuid4())[0:6]
    datasets_file = f"datasets_{uuid_suffix}.csv"
    profiles_file = f"profiles_{uuid_suffix}.csv"
    variables_file = f"variables_{uuid_suffix}.csv"

    if datasets.empty:
        print("No datasets scraped")
        return

    # see what standard names arent covered by our EOVs:
    standard_names_harvested = variables["standard_name"].to_list()
    standard_names_not_harvested = outersection(
        standard_names_harvested, supported_standard_names
    )
    print(
        "Found these standard_names that CEDA doesnt support yet:\n",
        standard_names_not_harvested,
    )
    # query CKAN national for more metadata related to the ERDDAP datsets we have so far
    print("Gathering CKAN data")
    df_ckan = get_ckan_records(datasets["dataset_id"].to_list(), cache=cache_requests)
    datasets = (
        datasets.set_index(["erddap_url", "dataset_id"])
        .join(df_ckan.set_index(["erddap_url", "dataset_id"]))
        .reset_index()
    )

    # TODO make scraper prioritize with organizations from CKAN and then pull ERDDAP if needed
    datasets["ckan_organizations"].fillna(datasets["organizations"], inplace=True)
    datasets["ckan_title"].fillna(datasets["title"], inplace=True)
    del datasets["title"]
    del datasets["organizations"]
    datasets.rename(columns={"ckan_title": "title"}, inplace=True)
    datasets.rename(columns={"ckan_organizations": "organizations"}, inplace=True)

    profiles["depth_min"] = profiles["depth_min"].fillna(0)
    profiles["depth_max"] = profiles["depth_max"].fillna(0)

    print("Adding", len(datasets), "datasets and", len(profiles), "profiles")
    if csv_only:
        datasets.to_csv(datasets_file, index=False)
        profiles.to_csv(profiles_file, index=False)
        variables.to_csv(variables_file, index=False)
        print("Wrote", datasets_file, profiles_file, variables_file)
    else:
        schema = "cioos_api"
        with engine.begin() as transaction:
            print("Writing to DB:")
            print("Clearing tables")
            transaction.execute("SELECT remove_all_data();")
            datasets.to_sql(
                "datasets",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            profiles.to_sql(
                "profiles",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            variables.to_sql(
                "erddap_variables",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )
            print("Processing new records")
            transaction.execute("SELECT profile_process();")
            transaction.execute("SELECT ckan_process();")
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
