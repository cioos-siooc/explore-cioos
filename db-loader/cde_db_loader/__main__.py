import argparse
import ast
import csv
import io
import logging
import os
import sys
import time
from contextlib import contextmanager

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
    key_cols = ["dataset_id", "latitude", "longitude"]
    agg = obis_cells.groupby(key_cols, dropna=False).agg(
        scientific_names=("scientific_names", lambda lists: sorted(set(name for lst in lists for name in lst))),
        n_records=("n_records", "sum"),
        time_min=("time_min", "min"),
        time_max=("time_max", "max"),
        depth_min=("depth_min", "min"),
        depth_max=("depth_max", "max"),
    ).reset_index()
    return agg


@contextmanager
def _timed(name, log):
    """Log how long a block of work took."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        log.info("Step '%s' took %.1fs", name, time.perf_counter() - t0)


def _pg_text_array(values):
    """Render a Python iterable as a PostgreSQL text-array literal: {"a","b\\"c"}."""
    def quote(s):
        return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'
    return "{" + ",".join(quote(v) for v in values) + "}"


def load_obis_cells_copy(df, table_name, transaction, schema=None):
    """Bulk-load an obis_cells DataFrame via COPY FROM STDIN.

    Replaces the previous to_sql-based loader: COPY runs ~10-50x faster than
    pandas to_sql() for the 100K+ row scale we hit on a full rebuild.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    cols = list(df.columns)
    for row in df.itertuples(index=False, name=None):
        out = []
        for col, val in zip(cols, row):
            if val is None or (isinstance(val, float) and pd.isna(val)):
                out.append(r"\N")
            elif col == "scientific_names":
                out.append(_pg_text_array(val if isinstance(val, (list, tuple)) else []))
            else:
                out.append(val)
        writer.writerow(out)
    buf.seek(0)

    qualified = f"{schema}.{table_name}" if schema else table_name
    raw = getattr(
        transaction.connection,
        "driver_connection",
        getattr(transaction.connection, "connection", transaction.connection),
    )
    with raw.cursor() as cur:
        cur.copy_expert(
            f"COPY {qualified} ({','.join(cols)}) "
            f"FROM STDIN WITH (FORMAT CSV, NULL '\\N')",
            buf,
        )
    logger.info("  obis_cells: %d rows loaded via COPY", len(df))


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
            datasets = ensure_organization_pks(datasets)
            with _timed("temp_datasets to_sql", logger):
                logger.info("Loading datasets into temp table")
                datasets.to_sql(
                    "temp_datasets",
                    con=transaction,
                    if_exists="append",
                    index=False,
                    dtype=DATASET_ARRAY_DTYPES,
                    method="multi",
                )

            if not profiles.empty:
                with _timed("temp_profiles to_sql", logger):
                    logger.info("Loading profiles into temp table")
                    prepare_profiles_dataframe(profiles).to_sql(
                        "temp_profiles",
                        con=transaction,
                        if_exists="append",
                        index=False,
                        method="multi",
                    )

            if obis_cells is not None:
                prepared = prepare_obis_cells_dataframe(obis_cells)
                with _timed("temp_obis_cells COPY", logger):
                    logger.info("Loading obis_cells into temp table (%d rows)", len(prepared))
                    load_obis_cells_copy(prepared, "temp_obis_cells", transaction)

            with _timed("temp_skipped_datasets to_sql", logger):
                logger.info("Loading skipped_datasets into temp table")
                skipped_datasets.to_sql(
                    "temp_skipped_datasets",
                    con=transaction,
                    if_exists="append",
                    index=False,
                    method="multi",
                )

            # Process and UPSERT all data using SQL functions
            with _timed("process_incremental_update", logger):
                logger.info("Running incremental update")
                transaction.execute(text("SELECT process_incremental_update();"))
                logger.info("Incremental update complete")

        else:
            # Original full reload logic
            logger.info("Using FULL RELOAD mode - will clear all data")

            # Session-level tuning for the bulk rebuild. SET LOCAL confines these
            # to the current transaction. synchronous_commit=OFF is acceptable
            # here because the rebuild is replayable from the harvest CSVs if
            # the COMMIT is lost; do NOT apply this in the incremental path.
            transaction.execute(text("""
                SET LOCAL work_mem = '256MB';
                SET LOCAL maintenance_work_mem = '1GB';
                SET LOCAL synchronous_commit = OFF;
                SET LOCAL temp_buffers = '256MB';
            """))

            with _timed("drop_constraints", logger):
                logger.info("Dropping constraints")
                transaction.execute(text("SELECT drop_constraints();"))

            with _timed("remove_all_data", logger):
                logger.info("Clearing tables")
                transaction.execute(text("SELECT remove_all_data();"))

            datasets = ensure_organization_pks(datasets)
            with _timed("datasets to_sql", logger):
                logger.info("Writing datasets")
                datasets.to_sql(
                    "datasets",
                    con=transaction,
                    if_exists="append",
                    schema=schema,
                    index=False,
                    dtype=DATASET_ARRAY_DTYPES,
                    method="multi",
                )

            if profiles.empty:
                logger.info("No profiles to write")
            else:
                with _timed("profiles to_sql", logger):
                    logger.info("Writing profiles")
                    prepare_profiles_dataframe(profiles).to_sql(
                        "profiles",
                        con=transaction,
                        if_exists="append",
                        schema=schema,
                        index=False,
                        method="multi",
                    )

            if obis_cells is not None:
                prepared = prepare_obis_cells_dataframe(obis_cells)
                with _timed("obis_cells COPY", logger):
                    logger.info("Writing obis_cells (%d rows)", len(prepared))
                    load_obis_cells_copy(prepared, "obis_cells", transaction, schema=schema)

            with _timed("skipped_datasets to_sql", logger):
                logger.info("Writing skipped_datasets")
                skipped_datasets.to_sql(
                    "skipped_datasets",
                    con=transaction,
                    if_exists="append",
                    schema=schema,
                    index=False,
                    method="multi",
                )

            with _timed("profile_process", logger):
                logger.info("Processing new records")
                transaction.execute(text("SELECT profile_process();"))
            with _timed("ckan_process", logger):
                transaction.execute(text("SELECT ckan_process();"))

            if obis_cells is not None:
                with _timed("obis_process", logger):
                    logger.info("Processing obis_cells")
                    # FALSE = non-concurrent matview refresh. Safe in a full
                    # rebuild (web-api is stopped, no readers to protect) and
                    # avoids CONCURRENTLY's diff-and-swap overhead.
                    transaction.execute(text("SELECT obis_process(FALSE);"))

            with _timed("create_hexes", logger):
                logger.info("Creating hexes")
                transaction.execute(text("SELECT create_hexes();"))

            with _timed("set_constraints", logger):
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
