import argparse
import ast
import logging
import os
import sys
import time

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

OBIS_ARRAY_DTYPES = {
    "scientific_names": ARRAY(TEXT),
}


PROFILES_ARRAY_DTYPES = {
    "scientific_names": ARRAY(TEXT),
}


def prepare_profiles_dataframe(profiles):
    """Clean and prepare profiles DataFrame for insertion."""
    profiles = profiles.replace("", np.NaN)
    profiles = profiles.drop(columns=["altitude_min", "altitude_max", "scientific_names"], errors="ignore").dropna(subset=['time_min'])
    return profiles


def prepare_obis_cells_dataframe(obis_cells):
    """Clean and prepare obis_cells DataFrame for insertion."""
    obis_cells = obis_cells.copy()
    # Parse scientific_names from CSV string repr back to list, or default to empty list
    obis_cells["scientific_names"] = obis_cells["scientific_names"].apply(
        lambda x: ast.literal_eval(x) if isinstance(x, str) else (x if isinstance(x, list) else [])
    )
    # Round lat/lon to 8 dp before dedup to avoid float-precision duplicates
    # (e.g. 45.83333333333333 vs 45.833333333333336 from grid arithmetic)
    obis_cells["latitude"] = obis_cells["latitude"].round(8)
    obis_cells["longitude"] = obis_cells["longitude"].round(8)

    # Deduplicate on unique key, merging scientific_names and aggregating numeric columns
    key_cols = ["erddap_url", "dataset_id", "latitude", "longitude"]
    agg = obis_cells.groupby(key_cols, dropna=False).agg(
        scientific_names=("scientific_names", lambda lists: sorted(set(name for lst in lists for name in lst))),
        n_records=("n_records", "sum"),
        time_min=("time_min", "min"),
        time_max=("time_max", "max"),
        depth_min=("depth_min", "min"),
        depth_max=("depth_max", "max"),
    ).reset_index()
    return agg


OBIS_CELLS_CHUNK_SIZE = 1000


def load_obis_cells_chunked(df, table_name, con, schema=None, if_exists="append"):
    """Load obis_cells DataFrame in chunks, logging progress."""
    total = len(df)
    loaded = 0
    first_chunk = True
    for start in range(0, total, OBIS_CELLS_CHUNK_SIZE):
        chunk = df.iloc[start : start + OBIS_CELLS_CHUNK_SIZE]
        chunk.to_sql(
            table_name,
            con=con,
            if_exists=if_exists if first_chunk else "append",
            schema=schema,
            index=False,
            dtype=OBIS_ARRAY_DTYPES,
        )
        loaded += len(chunk)
        logger.info("  obis_cells: %d / %d rows loaded", loaded, total)
        first_chunk = False


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
    logger.info("OBIS Loading testing")
    load_dotenv(os.getcwd() + "/.env")

    envs = os.environ

    db_host = envs.get('DB_HOST_EXTERNAL', 'localhost')
    database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{db_host}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"

    engine = create_engine(database_link)
    # test connection
    engine.connect()
    logger.info("Connected to %s", db_host)

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    obis_cells_file = f"{folder}/obis_cells.csv"

    logger.info("Reading %s, %s", datasets_file, skipped_datasets_file)

    datasets = pd.read_csv(datasets_file)
    profiles = pd.read_csv(profiles_file) if os.path.isfile(profiles_file) and os.path.getsize(profiles_file) > 1 else pd.DataFrame()
    skipped_datasets = pd.read_csv(skipped_datasets_file)

    obis_cells = None
    if os.path.isfile(obis_cells_file):
        logger.info("Reading %s", obis_cells_file)
        obis_cells = pd.read_csv(obis_cells_file)

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

            if not profiles.empty:
                logger.info("Loading profiles into temp table")
                prepare_profiles_dataframe(profiles).to_sql(
                    "temp_profiles",
                    con=transaction,
                    if_exists="append",
                    index=False,
                    dtype=PROFILES_ARRAY_DTYPES,
                )

            if obis_cells is not None:
                prepared = prepare_obis_cells_dataframe(obis_cells)
                logger.info("Loading obis_cells into temp table (%d rows)", len(prepared))
                load_obis_cells_chunked(prepared, "temp_obis_cells", transaction)

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
            if profiles.empty:
                logger.info("No profiles to write")
            else:
                prepare_profiles_dataframe(profiles).to_sql(
                    "profiles",
                    con=transaction,
                    if_exists="append",
                    schema=schema,
                    index=False,
                    dtype=PROFILES_ARRAY_DTYPES,
                )

            if obis_cells is not None:
                prepared = prepare_obis_cells_dataframe(obis_cells)
                logger.info("Writing obis_cells (%d rows)", len(prepared))
                load_obis_cells_chunked(prepared, "obis_cells", transaction, schema=schema)

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

            if obis_cells is not None:
                logger.info("Processing obis_cells")

                t = time.time()
                r = transaction.execute(text(
                    "UPDATE cde.obis_cells SET geom = ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857) WHERE geom IS NULL"
                ))
                logger.info("  set geom: %d rows (%.1fs)", r.rowcount, time.time() - t)

                t = time.time()
                r = transaction.execute(text("""
                    UPDATE cde.obis_cells c SET dataset_pk = d.pk
                    FROM cde.datasets d
                    WHERE c.dataset_id = d.dataset_id AND c.erddap_url = d.erddap_url AND c.dataset_pk IS NULL
                """))
                logger.info("  linked to datasets: %d rows (%.1fs)", r.rowcount, time.time() - t)

                t = time.time()
                r = transaction.execute(text("""
                    INSERT INTO cde.points (geom)
                    SELECT ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)
                    FROM (SELECT DISTINCT latitude, longitude FROM cde.obis_cells) sub
                    WHERE NOT EXISTS (
                        SELECT 1 FROM cde.points p
                        WHERE p.geom = ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857)
                    )
                """))
                logger.info("  inserted points: %d rows (%.1fs)", r.rowcount, time.time() - t)

                t = time.time()
                r = transaction.execute(text("""
                    UPDATE cde.obis_cells c SET point_pk = p.pk
                    FROM cde.points p
                    WHERE p.geom = ST_Transform(ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326), 3857)
                """))
                logger.info("  linked point_pk: %d rows (%.1fs)", r.rowcount, time.time() - t)

                t = time.time()
                r = transaction.execute(text("""
                    UPDATE cde.datasets d
                    SET n_profiles = (SELECT count(*) FROM cde.obis_cells c WHERE c.dataset_pk = d.pk)
                    WHERE d.erddap_url = 'https://obis.org'
                """))
                logger.info("  updated dataset n_profiles: %d datasets (%.1fs)", r.rowcount, time.time() - t)

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
