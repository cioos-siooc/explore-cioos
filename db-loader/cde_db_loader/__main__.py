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
            logger.info("Using INCREMENTAL mode - will load to temp tables, process, then UPSERT")

            # Incremental approach using temporary tables:
            # 1. Load all data into temporary tables (no constraints)
            # 2. Run all processing functions on temp tables
            # 3. UPSERT from temp tables into main tables

            # Create temporary tables that mirror the main tables structure WITHOUT constraints
            logger.info("Creating temporary tables")
            transaction.execute(text(f"""
                CREATE TEMP TABLE temp_datasets (LIKE {schema}.datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
                CREATE TEMP TABLE temp_profiles (LIKE {schema}.profiles INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);
                CREATE TEMP TABLE temp_skipped_datasets (LIKE {schema}.skipped_datasets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS);

                -- Explicitly drop all NOT NULL constraints from temp tables
                -- These are column-level constraints that EXCLUDING CONSTRAINTS doesn't remove
                ALTER TABLE temp_datasets
                    ALTER COLUMN dataset_id DROP NOT NULL,
                    ALTER COLUMN erddap_url DROP NOT NULL,
                    ALTER COLUMN cdm_data_type DROP NOT NULL,
                    ALTER COLUMN title DROP NOT NULL,
                    ALTER COLUMN organizations DROP NOT NULL,
                    ALTER COLUMN eovs DROP NOT NULL,
                    ALTER COLUMN n_profiles DROP NOT NULL,
                    ALTER COLUMN platform DROP NOT NULL,
                    ALTER COLUMN organization_pks DROP NOT NULL;

                ALTER TABLE temp_profiles
                    ALTER COLUMN geom DROP NOT NULL,
                    ALTER COLUMN dataset_pk DROP NOT NULL,
                    ALTER COLUMN erddap_url DROP NOT NULL,
                    ALTER COLUMN dataset_id DROP NOT NULL,
                    ALTER COLUMN time_min DROP NOT NULL,
                    ALTER COLUMN time_max DROP NOT NULL,
                    ALTER COLUMN latitude DROP NOT NULL,
                    ALTER COLUMN longitude DROP NOT NULL,
                    ALTER COLUMN depth_min DROP NOT NULL,
                    ALTER COLUMN depth_max DROP NOT NULL,
                    ALTER COLUMN n_records DROP NOT NULL,
                    ALTER COLUMN hex_zoom_0 DROP NOT NULL,
                    ALTER COLUMN hex_zoom_1 DROP NOT NULL,
                    ALTER COLUMN point_pk DROP NOT NULL,
                    ALTER COLUMN records_per_day DROP NOT NULL;
            """))

            # Load data into temp tables
            logger.info("Loading datasets into temp table")
            # Ensure array columns have empty arrays instead of null
            if 'organization_pks' not in datasets.columns or datasets['organization_pks'].isna().all():
                datasets['organization_pks'] = [[] for _ in range(len(datasets))]
            else:
                datasets['organization_pks'] = datasets['organization_pks'].apply(
                    lambda x: x if isinstance(x, list) else []
                )

            datasets.to_sql(
                "temp_datasets",
                con=transaction,
                if_exists="append",
                index=False,
                dtype={
                    "eovs": ARRAY(TEXT),
                    "organizations": ARRAY(TEXT),
                    "profile_variables": ARRAY(TEXT),
                    "organization_pks": ARRAY(INTEGER),
                },
            )

            logger.info("Loading profiles into temp table")
            profiles = profiles.replace("", np.NaN)
            profiles.drop(columns=["altitude_min", "altitude_max"], errors="ignore").dropna(subset=['time_min']).to_sql(
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

            # Run processing functions on temp tables
            logger.info("Processing temp tables")
            # Modify profile_process to work on temp tables
            transaction.execute(text("""
                -- Set geom from lat/lon
                UPDATE temp_profiles
                SET geom = ST_Transform(
                    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
                    3857
                )
                WHERE geom IS NULL;

                -- Link profiles to datasets via PK (from main datasets table)
                UPDATE temp_profiles p
                SET dataset_pk = d.pk
                FROM cde.datasets d
                WHERE p.dataset_id = d.dataset_id
                  AND p.erddap_url = d.erddap_url;

                -- Calculate days
                UPDATE temp_profiles
                SET days = date_part('days', time_max - time_min) + 1
                WHERE days IS NULL;
            """))

            # Now UPSERT from temp tables to main tables using efficient SQL
            logger.info("UPSERT datasets from temp table")
            transaction.execute(text(f"""
                INSERT INTO {schema}.datasets
                SELECT * FROM temp_datasets
                ON CONFLICT (dataset_id, erddap_url)
                DO UPDATE SET
                    platform = EXCLUDED.platform,
                    title = EXCLUDED.title,
                    title_fr = EXCLUDED.title_fr,
                    summary = EXCLUDED.summary,
                    summary_fr = EXCLUDED.summary_fr,
                    cdm_data_type = EXCLUDED.cdm_data_type,
                    organizations = EXCLUDED.organizations,
                    eovs = EXCLUDED.eovs,
                    ckan_id = EXCLUDED.ckan_id,
                    timeseries_id_variable = EXCLUDED.timeseries_id_variable,
                    profile_id_variable = EXCLUDED.profile_id_variable,
                    trajectory_id_variable = EXCLUDED.trajectory_id_variable,
                    profile_variables = EXCLUDED.profile_variables,
                    num_columns = EXCLUDED.num_columns,
                    first_eov_column = EXCLUDED.first_eov_column,
                    organization_pks = EXCLUDED.organization_pks,
                    n_profiles = EXCLUDED.n_profiles
            """))
            logger.info("Datasets upserted")

            # Temporarily drop constraints to allow inserting profiles with NULL hex values
            # (hex values will be populated by create_hexes() later)
            logger.info("Temporarily dropping constraints for profile insertion")
            transaction.execute(text("SELECT drop_constraints();"))

            # Delete old profiles for updated datasets, then insert new ones
            logger.info("Deleting old profiles for updated datasets")
            transaction.execute(text(f"""
                DELETE FROM {schema}.profiles p
                USING temp_datasets td
                WHERE p.dataset_id = td.dataset_id
                  AND p.erddap_url = td.erddap_url
            """))

            logger.info("Inserting new profiles")
            transaction.execute(text(f"""
                INSERT INTO {schema}.profiles
                SELECT * FROM temp_profiles
            """))
            logger.info("Profiles inserted")

            # UPSERT skipped_datasets
            logger.info("UPSERT skipped_datasets")
            transaction.execute(text(f"""
                -- Delete existing entries for these datasets
                DELETE FROM {schema}.skipped_datasets s
                USING temp_skipped_datasets ts
                WHERE s.dataset_id = ts.dataset_id
                  AND s.erddap_url = ts.erddap_url;

                -- Insert new entries
                INSERT INTO {schema}.skipped_datasets
                SELECT * FROM temp_skipped_datasets
            """))

            #Run ckan_process and other processing on the newly inserted/updated data
            logger.info("Running CKAN processing")
            transaction.execute(text("SELECT ckan_process();"))

            # Run profile_process to update any remaining fields
            logger.info("Running profile processing")
            transaction.execute(text("SELECT profile_process();"))

            # Recreate hexes for all data
            logger.info("Creating hexes")
            transaction.execute(text("SELECT create_hexes();"))

            # Restore constraints now that all fields are populated
            logger.info("Restoring constraints")
            transaction.execute(text("SELECT set_constraints();"))

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
