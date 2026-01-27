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
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import ARRAY, INTEGER, TEXT

from prefect import flow, get_run_logger

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


# Constants for array column types
DATASET_ARRAY_DTYPES = {
    "eovs": ARRAY(TEXT),
    "organizations": ARRAY(TEXT),
    "profile_variables": ARRAY(TEXT),
    "organization_pks": ARRAY(INTEGER),
}


def prepare_profiles_dataframe(profiles):
    """Clean and prepare profiles DataFrame for insertion."""
    profiles = profiles.replace("", np.NaN)
    return profiles.drop(columns=["altitude_min", "altitude_max"], errors="ignore").dropna(subset=['time_min'])


def ensure_organization_pks(datasets):
    """Ensure organization_pks column has empty arrays instead of null values."""
    if 'organization_pks' not in datasets.columns or datasets['organization_pks'].isna().all():
        datasets['organization_pks'] = [[] for _ in range(len(datasets))]
    else:
        datasets['organization_pks'] = datasets['organization_pks'].apply(
            lambda x: x if isinstance(x, list) else []
        )
    return datasets

@flow(name="cde-db-loader")
def main(folder, incremental=False):
    # setup database connection
    logger = get_run_logger()
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

        if incremental:
            logger.info("Using INCREMENTAL mode - will load to temp tables, process, then UPSERT")

            # Incremental approach using temporary tables:
            # 1. Load all data into temporary tables (no constraints)
            # 2. Run all processing functions on temp tables
            # 3. UPSERT from temp tables into main tables

            # Create temporary tables that mirror the main tables structure WITHOUT constraints
            logger.info("Creating temporary tables")
            transaction.execute(text("SELECT create_temp_tables();"))

            # Load data into temp tables
            logger.info("Loading datasets into temp table")
            datasets = ensure_organization_pks(datasets)
            datasets.to_sql(
                "temp_datasets",
                con=transaction,
                if_exists="append",
                index=False,
                dtype=DATASET_ARRAY_DTYPES,
            )

            logger.info("Loading profiles into temp table")
            prepare_profiles_dataframe(profiles).to_sql(
                "temp_profiles",
                con=transaction,
                if_exists="append",
                index=False,
            )

            logger.info("Loading skipped_datasets into temp table")
            skipped_datasets.to_sql(
                "temp_skipped_datasets",
                con=transaction,
                if_exists="append",
                index=False,
            )

            # Process and UPSERT all data using SQL functions
            logger.info("Running incremental update")
            transaction.execute(text("SELECT process_incremental_update();"))
            logger.info("Incremental update complete")

        else:
            # Original full reload logic
            logger.info("Using FULL RELOAD mode - will clear all data")

            logger.info("Dropping constraints")
            transaction.execute(text("SELECT drop_constraints();"))

            logger.info("Clearing tables")
            transaction.execute(text("SELECT remove_all_data();"))

            logger.info("Writing datasets")
            datasets.to_sql(
                "datasets",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
                dtype=DATASET_ARRAY_DTYPES,
            )

            logger.info("Writing profiles")
            logger.info("profiles.columns: %s", profiles.columns)
            prepare_profiles_dataframe(profiles).to_sql(
                "profiles",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
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
            transaction.execute(text("SELECT profile_process();"))
            transaction.execute(text("SELECT ckan_process();"))

            logger.info("Creating hexes")
            transaction.execute(text("SELECT create_hexes();"))

            # This ensures that all fields were set successfully
            logger.info("Setting constraints")
            transaction.execute(text("SELECT set_constraints();"))

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
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Use UPSERT instead of deleting all data - only update/insert changed datasets",
        default=os.environ.get("INCREMENTAL_MODE", "false").lower() == "true",
    )

    args = parser.parse_args()
    try:
        main(args.folder, args.incremental)
    except Exception:
        logger.error("Failed to write to db", exc_info=True)
        sys.exit(1)
