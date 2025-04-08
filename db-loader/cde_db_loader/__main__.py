import argparse
import ast
import logging
import os
import sys

import numpy as np
import pandas as pd
import sentry_sdk
from cde_harvester.utils import df_cde_eov_to_standard_name
from dotenv import load_dotenv
from sentry_sdk.integrations.logging import LoggingIntegration
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import ARRAY, INTEGER, TEXT

logging.getLogger("urllib3").setLevel(logging.WARNING)

logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(levelname)-8s - %(name)s : %(message)s"
)
logger = logging.getLogger()

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[
        LoggingIntegration(
            level=logging.INFO,  # Capture info and above as breadcrumbs
            event_level=logging.WARNING,  # Send records as events
        ),
    ],
    environment=os.environ.get("ENVIRONMENT", "development"),
)


def main(folder):
    # setup database connection

    load_dotenv(os.getcwd() + "/.env")

    envs = os.environ

    database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"

    engine = create_engine(database_link)
    # test connection
    engine.connect()
    logger.info("Connected to %s", envs["DB_HOST_EXTERNAL"])

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"

    logger.info(
        "Reading %s,%s, %s", datasets_file, profiles_file, skipped_datasets_file
    )

    # ckan_file = f"ckan_{uuid_suffix}.csv"

    datasets = pd.read_csv(datasets_file)
    profiles = pd.read_csv(profiles_file)
    profiles = profiles.drop(columns=["altitude_min", "altitude_max"], errors="ignore")
    skipped_datasets = pd.read_csv(skipped_datasets_file)

    datasets["eovs"] = datasets["eovs"].apply(ast.literal_eval)
    datasets["organizations"] = datasets["organizations"].apply(ast.literal_eval)
    datasets["profile_variables"] = datasets["profile_variables"].apply(
        ast.literal_eval
    )

    if datasets.empty:
        logger.info("No datasets found")
        sys.exit(1)

    # this gets a list of all the standard names

    schema = "cde"
    with engine.begin() as transaction:
        logger.info("Writing to DB:")

        logger.info("Dropping constraints")
        transaction.execute("SELECT drop_constraints();")

        logger.info("Clearing tables")
        transaction.execute("SELECT remove_all_data();")

        logger.info("Writing datasets")

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

        logger.info("Writing profiles")

        # profiles has some columns to fix up first
        profiles.to_sql(
            "profiles",
            con=transaction,
            if_exists="append",
            schema=schema,
            index=False,
            # method="multi",
        )

        logger.info("Writing skipped_datasets")
        skipped_datasets.to_sql(
            "skipped_datasets",
            con=transaction,
            if_exists="append",
            schema=schema,
            index=False,
        )

        logger.info("Processing new records")
        transaction.execute("SELECT profile_process();")
        transaction.execute("SELECT ckan_process();")

        logger.info("Creating hexes")
        transaction.execute("SELECT create_hexes();")

        # This ensures that all fields were set successfully
        logger.info("Setting constraints")
        transaction.execute("SELECT set_constraints();")

        logger.info("Wrote to db: %s", f"{schema}.datasets")
        logger.info("Wrote to db: %s", f"{schema}.profiles")
        logger.info("Wrote to db: %s", f"{schema}.skipped_datasets")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--folder",
        required=False,
        default="harvest",
        help="folder with the CSV output files from harvesting",
    )

    args = parser.parse_args()
    try:
        main(args.folder)
    except Exception:
        logger.error("Failed to write to db", exc_info=True)
        sys.exit(1)
