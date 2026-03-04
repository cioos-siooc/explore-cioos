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

from prefect import task, get_run_logger

logging.getLogger("urllib3").setLevel(logging.WARNING)

logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(levelname)-8s - %(name)s : %(message)s"
)

logger = logging.getLogger()


sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[
        LoggingIntegration(
            level=logging.INFO,
            event_level=logging.WARNING,
        ),
    ],
    environment=os.environ.get("ENVIRONMENT", "development"),
)


DATASET_ARRAY_DTYPES = {
    "eovs": ARRAY(TEXT),
    "organizations": ARRAY(TEXT),
    "profile_variables": ARRAY(TEXT),
    "organization_pks": ARRAY(INTEGER),
}


def prepare_profiles_dataframe(profiles):
    """Clean and prepare profiles DataFrame for insertion."""
    profiles = profiles.replace("", np.NaN)
    return profiles.drop(columns=["altitude_min", "altitude_max"], errors="ignore").dropna(subset=["time_min"])


def ensure_organization_pks(datasets):
    """Ensure organization_pks column has empty arrays instead of null values."""
    if "organization_pks" not in datasets.columns or datasets["organization_pks"].isna().all():
        datasets["organization_pks"] = [[] for _ in range(len(datasets))]
    else:
        datasets["organization_pks"] = datasets["organization_pks"].apply(
            lambda x: x if isinstance(x, list) else []
        )
    return datasets


def _run_upload(engine, datasets, profiles, skipped_datasets, incremental, upload_logger):
    """Core DB upload logic (no Prefect decorators)."""
    schema = "cde"
    with engine.begin() as transaction:
        upload_logger.info("Writing to DB:")

        if incremental:
            upload_logger.info("INCREMENTAL mode — load to temp tables, then UPSERT")

            upload_logger.info("Creating temporary tables")
            transaction.execute(text("SELECT create_temp_tables();"))

            upload_logger.info("Loading datasets into temp table")
            datasets = ensure_organization_pks(datasets)
            datasets.to_sql(
                "temp_datasets",
                con=transaction,
                if_exists="append",
                index=False,
                dtype=DATASET_ARRAY_DTYPES,
            )

            upload_logger.info("Loading profiles into temp table")
            prepare_profiles_dataframe(profiles).to_sql(
                "temp_profiles",
                con=transaction,
                if_exists="append",
                index=False,
            )

            upload_logger.info("Loading skipped_datasets into temp table")
            skipped_datasets.to_sql(
                "temp_skipped_datasets",
                con=transaction,
                if_exists="append",
                index=False,
            )

            upload_logger.info("Running incremental update")
            transaction.execute(text("SELECT process_incremental_update();"))
            upload_logger.info("Incremental update complete")

        else:
            upload_logger.info("FULL RELOAD mode — clearing all data")

            upload_logger.info("Dropping constraints")
            transaction.execute(text("SELECT drop_constraints();"))

            upload_logger.info("Clearing tables")
            transaction.execute(text("SELECT remove_all_data();"))

            upload_logger.info("Writing datasets")
            datasets.to_sql(
                "datasets",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
                dtype=DATASET_ARRAY_DTYPES,
            )

            upload_logger.info("Writing profiles")
            upload_logger.info("profiles.columns: %s", profiles.columns)
            prepare_profiles_dataframe(profiles).to_sql(
                "profiles",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            upload_logger.info("Writing skipped_datasets")
            skipped_datasets.to_sql(
                "skipped_datasets",
                con=transaction,
                if_exists="append",
                schema=schema,
                index=False,
            )

            upload_logger.info("Processing new records")
            transaction.execute(text("SELECT profile_process();"))
            transaction.execute(text("SELECT ckan_process();"))

            upload_logger.info("Creating hexes")
            transaction.execute(text("SELECT create_hexes();"))

            upload_logger.info("Setting constraints")
            transaction.execute(text("SELECT set_constraints();"))

        upload_logger.info("Wrote to db: %s.datasets", schema)
        upload_logger.info("Wrote to db: %s.profiles", schema)
        upload_logger.info("Wrote to db: %s.skipped_datasets", schema)


def upload_server_data(folder, incremental=True):
    """
    Read harvested CSVs from `folder` and upload them to the database.
    Called from the harvester's upload_to_db task (always incremental=True).
    Can also be used standalone.
    """
    load_dotenv(os.getcwd() + "/.env")
    envs = os.environ

    database_link = (
        f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}"
        f"@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
    )
    engine = create_engine(database_link)
    engine.connect()
    logger.info("Connected to %s", envs["DB_HOST_EXTERNAL"])

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"

    logger.info("Reading %s, %s, %s", datasets_file, profiles_file, skipped_datasets_file)

    datasets = pd.read_csv(datasets_file)
    profiles = pd.read_csv(profiles_file)
    skipped_datasets = pd.read_csv(skipped_datasets_file)

    datasets["eovs"] = datasets["eovs"].apply(ast.literal_eval)
    datasets["organizations"] = datasets["organizations"].apply(ast.literal_eval)
    datasets["profile_variables"] = datasets["profile_variables"].apply(ast.literal_eval)

    if datasets.empty:
        logger.info("No datasets found in %s", folder)
        return

    _run_upload(engine, datasets, profiles, skipped_datasets, incremental, logger)


@task(name="cde-db-loader")
def main(folder, incremental=False):
    flow_logger = get_run_logger()
    flow_logger.info("Running db-loader for folder: %s (incremental=%s)", folder, incremental)
    upload_server_data(folder, incremental)


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
        help="Use UPSERT instead of deleting all data",
        default=os.environ.get("INCREMENTAL_MODE", "false").lower() == "true",
    )

    args = parser.parse_args()
    try:
        main(args.folder, args.incremental)
    except Exception:
        logger.error("Failed to write to db", exc_info=True)
        sys.exit(1)
