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


def main(folder, incremental=False):
    # setup database connection
    
    # Use a helper function to handle array columns properly
    def is_valid_value(val):
        if isinstance(val, (list, np.ndarray)):
            return True  # Arrays are always valid
        return pd.notna(val)

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
            logger.info("Using INCREMENTAL mode - will UPSERT datasets and profiles")

            # For incremental mode, we need to:
            # 1. UPSERT datasets (update if exists, insert if new)
            # 2. Delete old profiles for these datasets, then insert new ones
            # 3. UPSERT skipped_datasets

            # First, handle datasets with UPSERT
            logger.info("UPSERT datasets")
            for _, row in datasets.iterrows():
                # Build the column list and values dynamically
                cols = [
                    "dataset_id", "erddap_url", "platform", "title", "title_fr",
                    "summary", "summary_fr", "cdm_data_type", "organizations",
                    "eovs", "ckan_id", "timeseries_id_variable", "profile_id_variable",
                    "trajectory_id_variable", "profile_variables", "num_columns",
                    "first_eov_column"
                ]

                # Filter out columns that don't exist in the row or are NaN
                available_cols = [col for col in cols if col in row.index and is_valid_value(row[col])]

                # Build INSERT statement
                insert_cols = ", ".join(available_cols)
                insert_vals = ", ".join([f":{col}" for col in available_cols])

                # Build UPDATE statement (exclude unique constraint columns)
                update_cols = [col for col in available_cols if col not in ["dataset_id", "erddap_url"]]
                update_set = ", ".join([f"{col} = EXCLUDED.{col}" for col in update_cols])

                sql = text(f"""
                    INSERT INTO {schema}.datasets ({insert_cols})
                    VALUES ({insert_vals})
                    ON CONFLICT (dataset_id, erddap_url)
                    DO UPDATE SET {update_set}
                """)

                # Prepare parameters, converting lists to PostgreSQL arrays
                params = {}
                for col in available_cols:
                    val = row[col]
                    if isinstance(val, list):
                        params[col] = val
                    else:
                        params[col] = val

                transaction.execute(sql, params)

            logger.info("Upserted %d datasets", len(datasets))

            # Delete old profiles for the datasets we're updating
            logger.info("Deleting old profiles for updated datasets")
            for _, row in datasets.iterrows():
                delete_sql = text(f"""
                    DELETE FROM {schema}.profiles
                    WHERE dataset_id = :dataset_id AND erddap_url = :erddap_url
                """)
                transaction.execute(delete_sql, {
                    "dataset_id": row["dataset_id"],
                    "erddap_url": row["erddap_url"]
                })

            logger.info("Deleted old profiles")

        else:
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
                dtype={
                    "eovs": ARRAY(TEXT),
                    "organizations": ARRAY(TEXT),
                    "profile_variables": ARRAY(TEXT),
                    "organization_pks": ARRAY(INTEGER),
                },
            )

        # Insert profiles (works for both modes - incremental already deleted old ones)
        profiles = profiles.replace("", np.NaN)
        logger.info("Writing profiles")
        logger.info("profiles.columns: %s", profiles.columns)
        profiles.drop(columns=["altitude_min", "altitude_max"], errors="ignore").dropna(subset=['time_min']).to_sql(
            "profiles",
            con=transaction,
            if_exists="append",
            schema=schema,
            index=False,
        )

        # Handle skipped_datasets
        if incremental:
            logger.info("UPSERT skipped_datasets")
            for _, row in skipped_datasets.iterrows():
                sql = text(f"""
                    DELETE FROM {schema}.skipped_datasets
                    WHERE dataset_id = :dataset_id AND erddap_url = :erddap_url;

                    INSERT INTO {schema}.skipped_datasets (erddap_url, dataset_id, reason_code)
                    VALUES (:erddap_url, :dataset_id, :reason_code)
                """)
                transaction.execute(sql, {
                    "dataset_id": row["dataset_id"],
                    "erddap_url": row["erddap_url"],
                    "reason_code": row.get("reason_code", "")
                })
        else:
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
        if not incremental:
            logger.info("Setting constraints")
            transaction.execute(text("SELECT set_constraints();"))
        else:
            logger.info("Skipping constraint refresh in incremental mode (constraints already exist)")

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
