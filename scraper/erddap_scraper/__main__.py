import argparse
import threading
import uuid
import os
from dotenv import load_dotenv



import pandas as pd
from sqlalchemy import create_engine, types

from erddap_scraper.scrape_erddap import scrape_erddap

float_type = types.Float(precision=3, asdecimal=True)
dtypes_profile = {
    "latitude_min": float_type,
    "latitude_max": float_type,
    "longitude_min": float_type,
    "longitude_max": float_type,
    "depth_min": float_type,
    "depth_max": float_type,
}


def main(erddap_urls, csv_only):
    # setup database connection
    # This is only run from outside docker
    if not csv_only:
        load_dotenv(os.getcwd() + '/.env')

        envs=os.environ

        database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:5432/{envs['DB_NAME']}"

        engine = create_engine(database_link)
        # test connection
        engine.connect()

    erddap_urls = args.erddap_urls.split(",")
    dataset_ids = None
    if args.dataset_ids:
        dataset_ids = args.dataset_ids.split(",")

    threads = []
    result = []

    for erddap_url in erddap_urls:
        print("Starting scraper:", erddap_url)
        scraping_thread = threading.Thread(
            target=scrape_erddap, args=(erddap_url, result, dataset_ids)
        )
        scraping_thread.start()
        threads.append(scraping_thread)

    for thread in threads:
        thread.join()

    profiles = pd.DataFrame()
    datasets = pd.DataFrame()

    datasets_not_added_total = []

    for [profile, dataset, datasets_not_added] in result:
        profiles = profiles.append(profile)
        datasets = datasets.append(dataset)
        datasets_not_added_total = datasets_not_added_total + datasets_not_added

    uuid_suffix = str(uuid.uuid4())[0:6]
    datasets_file = f"datasets_{uuid_suffix}.csv"
    profiles_file = f"profiles_{uuid_suffix}.csv"

    if datasets.empty:
        print("No datasets scraped")
        return

    # set all null depths to 0
    profiles["depth_min"] = profiles["depth_min"].fillna(0)
    profiles["depth_max"] = profiles["depth_max"].fillna(0)

    profiles_bad_geom_query = "(latitude_min <= -90) or (latitude_max >= 90) or (longitude_min <= -180) or (longitude_max >= 180)"
    profiles_bad_geom = profiles.query(profiles_bad_geom_query)

    if not profiles_bad_geom.empty:
        print(
            "These profiles with bad lat/long values will be removed:",
            profiles_bad_geom,
        )
        profiles.drop(profiles_bad_geom.index, inplace=True)

    if csv_only:
        datasets.to_csv(datasets_file, index=False)
        profiles.to_csv(profiles_file, index=False)
        print(f"Wrote {datasets_file} and {profiles_file}")
    else:
        schema = "cioos_api"
        with engine.begin() as transaction:
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
                dtype=dtypes_profile,
                index=False,
            )
            transaction.execute("SELECT profile_process();")
            transaction.execute("SELECT create_hexes();")

            print("Wrote to db:", f"{schema}.profiles_data_loader")
            print("Wrote to db:", f"{schema}.datasets_data_loader")

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
    args = parser.parse_args()
    main(args.erddap_urls, args.csv_only)
