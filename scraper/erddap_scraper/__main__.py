import sys
import argparse
import os
import threading
import uuid
import logging 

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine

from erddap_scraper.scrape_erddap import scrape_erddap

def setup_logging(log_time):
    # setup logging
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    handler = logging.StreamHandler(sys.stdout)
    
    if log_time:
        format = '%(asctime)s - %(name)s : %(message)s'
    else:
        format = '%(name)s : %(message)s'
    
    formatter = logging.Formatter(format)
    
    handler.setFormatter(formatter)
    root.addHandler(handler)

def main(erddap_urls, csv_only):
    # setup database connection
    # This is only run from outside docker
    if not csv_only:
        load_dotenv(os.getcwd() + "/.env")

        envs = os.environ

        database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"

        engine = create_engine(database_link)
        # test connection
        engine.connect()
        print("Connected to ", database_link)

    erddap_urls = args.erddap_urls.split(",")
    limit_dataset_ids = None
    if args.dataset_ids:
        limit_dataset_ids = args.dataset_ids.split(",")

    threads = []
    result = []

    for erddap_url in erddap_urls:
        scraping_thread = threading.Thread(
            target=scrape_erddap, args=(erddap_url, result, limit_dataset_ids)
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

    profiles_bad_geom_query = "((latitude_min <= -90) or (latitude_max >= 90) or (longitude_min <= -180) or (longitude_max >= 180))"
    profiles_bad_geom = profiles.query(profiles_bad_geom_query)

    if not profiles_bad_geom.empty:
        print(
            "These profiles with bad lat/long values will be removed:",
            profiles_bad_geom.to_csv(None),
        )
        profiles = profiles.query("not " + profiles_bad_geom_query)
    print("Adding", len(datasets), "datasets and", len(profiles), "profiles")
    if csv_only:
        datasets.to_csv(datasets_file, index=False)
        profiles.to_csv(profiles_file, index=False)
        variables.to_csv(variables_file)
        print("Wrote", datasets_file, profiles_file, variables_file)
    else:
        schema = "cioos_api"
        with engine.begin() as transaction:
            print("Writing to DB:")
            print("Clearing tables")
            transaction.execute("SELECT remove_all_data();")
            datasets.to_sql(
                "datasets_data_loader",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )
            profiles.to_sql(
                "profiles_data_loader",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            variables.reset_index().to_sql(
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

        print("Wrote to db:", f"{schema}.datasets_data_loader")
        print("Wrote to db:", f"{schema}.profiles_data_loader")
        print("Wrote to db:", f"{schema}.erddap_variables")

    print("datasets_not_added_total", datasets_not_added_total)


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
                        '--log-level',
                        default='debug',
                        help='Provide logging level. Example --loglevel debug, default=debug' )
    parser.add_argument(
                        '--log-time',
                        type=bool,
                        default=False,
                        nargs='?',
                        help='add time to logs' )

    args = parser.parse_args()
    setup_logging(args.log_time)
    
    main(args.erddap_urls, args.csv_only)

