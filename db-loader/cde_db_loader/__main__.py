import argparse
import logging
import os
import ast

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import ARRAY, TEXT, INTEGER
from erddap_scraper.utils import (
    df_cde_eov_to_standard_name,
)

logging.getLogger("urllib3").setLevel(logging.WARNING)


def main(folder):
    # setup database connection
    # This is only run from outside docker

    load_dotenv(os.getcwd() + "/.env")

    envs = os.environ

    database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"

    engine = create_engine(database_link)
    # test connection
    engine.connect()
    print("Connected to ", envs["DB_HOST_EXTERNAL"])

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    variables_file = f"{folder}/variables.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"

    print(
        "Reading", datasets_file, profiles_file, variables_file, skipped_datasets_file
    )

    # ckan_file = f"ckan_{uuid_suffix}.csv"

    datasets = pd.read_csv(datasets_file)
    profiles = pd.read_csv(profiles_file)
    variables = pd.read_csv(variables_file)
    skipped_datasets = pd.read_csv(skipped_datasets_file)

    profiles["hex_zoom_0"] = None
    profiles["hex_zoom_1"] = None

    datasets["eovs"] = datasets["eovs"].apply(ast.literal_eval)
    datasets["organization_pks"] = None
    datasets["organizations"] = datasets["organizations"].apply(ast.literal_eval)
    datasets["profile_variables"] = datasets["profile_variables"].apply(
        ast.literal_eval
    )
    datasets.to_csv("d.csv")
    # ckan = pd.read_csv(ckan_file)

    if datasets.empty:
        print("No datasets scraped")
        return

    # this gets a list of all the standard names

    schema = "cioos_api"
    with engine.begin() as transaction:
        print("Writing to DB:")

        print("Dropping constraints")
        transaction.execute("SELECT drop_constraints();")

        print("Clearing tables")
        transaction.execute("SELECT remove_all_data();")

        print("Writing datasets")

        datasets.to_sql(
            "datasets",
            con=transaction,
            if_exists="append",
            schema=schema,
            index=False,
            dtype={
                "eovs": ARRAY(TEXT),
                "organizations": ARRAY(TEXT),
                "profile_variables": ARRAY(TEXT),
                "organization_pks": ARRAY(INTEGER),
            },
        )

        profiles = profiles.replace("", np.NaN)

        print("Writing profiles")

        # profiles has some columns to fix up first
        profiles.to_sql(
            "profiles",
            con=transaction,
            if_exists="append",
            schema=schema,
            index=False,
            # method="multi",
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
        skipped_datasets.to_sql(
            "skipped_datasets",
            con=transaction,
            if_exists="append",
            schema=schema,
            index=False,
        )

        print("Writing eov_to_standard_name")
        df_cde_eov_to_standard_name.to_sql(
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

        # This ensures that all fields were set successfully
        transaction.execute("SELECT set_constraints();")

        print("Wrote to db:", f"{schema}.datasets")
        print("Wrote to db:", f"{schema}.profiles")
        print("Wrote to db:", f"{schema}.erddap_variables")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")

    parser.add_argument(
        "--log-level",
        default="debug",
        help="Provide logging level. Example --loglevel debug, default=debug",
    )

    args = parser.parse_args()

    main(args.folder)
