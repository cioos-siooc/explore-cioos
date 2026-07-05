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
from sqlalchemy import text

from prefect import get_run_logger, task

from cde_harvester.core.db import create_db_engine, db_host
from cde_harvester.core.observability import init_sentry
from cde_harvester.core.schemas import DATASET_ARRAY_DTYPES, OBIS_ARRAY_DTYPES

logging.getLogger("urllib3").setLevel(logging.WARNING)

# Transaction-scoped advisory lock key. Loads must run STRICTLY one-at-a-time over
# the SHARED cde tables: a single-source incremental can never interleave with the
# nightly full-reload (whose remove_all_data() TRUNCATEs every table), and two
# incremental loads can't fight over drop/set_constraints + DELETE/INSERT.
#
# The lock is NOT taken at the top of the transaction. Incremental loads first
# populate session-private temp tables (no shared-table contention) WITHOUT the
# lock, then acquire it only around process_incremental_update() — the phase that
# actually touches the shared tables. This keeps the lock held for minutes, not the
# whole bulk upload (~tens of minutes), so concurrent loaders upload in parallel and
# only serialize on the short processing phase. Full reloads still take the lock for
# their entire transaction (they TRUNCATE shared tables from the start). A late-
# acquiring incremental is still correct: the full-reload holds the same lock, so the
# worst case is the incremental simply waits behind it. pg_advisory_xact_lock auto-
# releases at COMMIT/ROLLBACK. Arbitrary stable constant ("CDE-LOADER").
DB_LOADER_ADVISORY_LOCK_KEY = 738825001

logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(levelname)-8s - %(name)s : %(message)s"
)

logger = logging.getLogger()


init_sentry()


def prepare_profiles_dataframe(profiles):
    """Clean and prepare profiles DataFrame for insertion."""
    profiles = profiles.replace("", np.NaN)
    # Both time bounds are NOT NULL in cde.profiles. Drop either-null rows here,
    # mirroring the harvester's filter (profiles.py): a time_max that passes the
    # harvester's null check but fails parse_erddap_dates' coerce becomes NaT and
    # would otherwise slip through and fail set_constraints().
    profiles = profiles.drop(
        columns=["altitude_min", "altitude_max", "scientific_names"], errors="ignore"
    ).dropna(subset=["time_min", "time_max"])
    return profiles


def prepare_obis_cells_dataframe(obis_cells, name_to_aphia=None):
    """Clean and prepare obis_cells DataFrame for insertion.

    ``name_to_aphia`` (dict[str, int], optional) populates the aphia_ids
    column at COPY time so the post-load obis_backfill_aphia_ids() UPDATE has
    far fewer rows to touch. Names absent from the dict yield empty arrays
    here and are picked up by the backfill (which still runs to handle rows
    whose names weren't yet in scientific_name_vernaculars at COPY time).
    """
    obis_cells = obis_cells.copy()
    # Parse scientific_names from CSV string repr back to list, or default to empty list
    obis_cells["scientific_names"] = obis_cells["scientific_names"].apply(
        lambda x: (
            ast.literal_eval(x)
            if isinstance(x, str)
            else (x if isinstance(x, list) else [])
        )
    )
    # Round lat/lon to 8 dp before dedup to avoid float-precision duplicates
    # (e.g. 45.83333333333333 vs 45.833333333333336 from grid arithmetic)
    obis_cells["latitude"] = obis_cells["latitude"].round(8)
    obis_cells["longitude"] = obis_cells["longitude"].round(8)

    # Deduplicate on unique key, merging scientific_names and aggregating numeric columns
    key_cols = ["dataset_id", "latitude", "longitude"]
    agg = (
        obis_cells.groupby(key_cols, dropna=False)
        .agg(
            scientific_names=(
                "scientific_names",
                lambda lists: sorted(set(name for lst in lists for name in lst)),
            ),
            n_records=("n_records", "sum"),
            time_min=("time_min", "min"),
            time_max=("time_max", "max"),
            depth_min=("depth_min", "min"),
            depth_max=("depth_max", "max"),
        )
        .reset_index()
    )

    if name_to_aphia:

        def resolve(names):
            return sorted({name_to_aphia[n] for n in names if n in name_to_aphia})

        agg["aphia_ids"] = agg["scientific_names"].apply(resolve)
    else:
        agg["aphia_ids"] = [[] for _ in range(len(agg))]

    # Same bigint/COPY constraint as prepare_trajectory_cells_dataframe.
    agg["n_records"] = agg["n_records"].round().astype("Int64")
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


def _pg_int_array(values):
    """Render a Python iterable as a PostgreSQL int-array literal: {1,2,3}."""
    if not values:
        return "{}"
    return "{" + ",".join(str(int(v)) for v in values) + "}"


def load_cells_copy(df, table_name, transaction, schema=None):
    """Bulk-load a cells DataFrame (obis_cells / trajectory_cells) via COPY
    FROM STDIN.

    Replaces the previous to_sql-based loader: COPY runs ~10-50x faster than
    pandas to_sql() for the 100K+ row scale we hit on a full rebuild.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    cols = list(df.columns)
    for row in df.itertuples(index=False, name=None):
        out = []
        for col, val in zip(cols, row):
            if val is None or val is pd.NA or (isinstance(val, float) and pd.isna(val)):
                out.append(r"\N")
            elif col == "scientific_names":
                out.append(
                    _pg_text_array(val if isinstance(val, (list, tuple)) else [])
                )
            elif col == "aphia_ids":
                out.append(_pg_int_array(val if isinstance(val, (list, tuple)) else []))
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
    logger.info("  %s: %d rows loaded via COPY", table_name, len(df))


# Backwards-compatible alias (pre-M2 name).
load_obis_cells_copy = load_cells_copy


def prepare_trajectory_cells_dataframe(trajectory_cells):
    """Clean and prepare trajectory_cells DataFrame for insertion.

    Mirrors prepare_obis_cells_dataframe: round coordinates to 8 dp to avoid
    float-precision duplicates, then deduplicate on the table's unique key,
    aggregating extents/counts defensively.
    """
    cells = trajectory_cells.copy()
    cells["trajectory_id"] = cells["trajectory_id"].fillna("").astype(str)
    cells["latitude"] = cells["latitude"].round(8)
    cells["longitude"] = cells["longitude"].round(8)

    key_cols = ["erddap_url", "dataset_id", "trajectory_id", "latitude", "longitude"]
    agg = (
        cells.groupby(key_cols, dropna=False)
        .agg(
            time_min=("time_min", "min"),
            time_max=("time_max", "max"),
            depth_min=("depth_min", "min"),
            depth_max=("depth_max", "max"),
            n_records=("n_records", "sum"),
            n_profiles=("n_profiles", "sum"),
            records_per_day=("records_per_day", "sum"),
            days=("days", "max"),
        )
        .reset_index()
    )
    # COPY does no casting: these land in bigint columns, and pandas upcasts
    # counts to float64 ("2.0") as soon as a NaN is involved anywhere upstream.
    # Nullable Int64 renders as "2" / \N in the COPY buffer.
    for col in ("n_records", "n_profiles", "days"):
        agg[col] = agg[col].round().astype("Int64")
    return agg


def ensure_organization_pks(datasets):
    """Ensure organization_pks column has empty arrays instead of null values."""
    if (
        "organization_pks" not in datasets.columns
        or datasets["organization_pks"].isna().all()
    ):
        datasets["organization_pks"] = [[] for _ in range(len(datasets))]
    else:
        datasets["organization_pks"] = datasets["organization_pks"].apply(
            lambda x: x if isinstance(x, list) else []
        )
    return datasets

@task(name="cde-db-loader")
def main(folder, incremental=False):
    # setup database connection
    logger = get_run_logger()

    engine = create_db_engine()
    # test connection
    engine.connect()
    logger.info("Connected to %s", db_host())

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    obis_cells_file = f"{folder}/obis_cells.csv"
    trajectory_cells_file = f"{folder}/trajectory_cells.csv"
    verified_file = f"{folder}/verified.csv"
    harvest_runs_file = f"{folder}/harvest_runs.csv"
    harvest_attempts_file = f"{folder}/harvest_attempts.csv"

    logger.info("Reading %s, %s", datasets_file, skipped_datasets_file)

    datasets = pd.read_csv(datasets_file)
    profiles = (
        pd.read_csv(profiles_file)
        if os.path.isfile(profiles_file) and os.path.getsize(profiles_file) > 1
        else pd.DataFrame()
    )
    skipped_datasets = pd.read_csv(skipped_datasets_file)

    obis_cells = None
    if os.path.isfile(obis_cells_file):
        logger.info("Reading %s", obis_cells_file)
        obis_cells = pd.read_csv(obis_cells_file)

    trajectory_cells = None
    if os.path.isfile(trajectory_cells_file):
        logger.info("Reading %s", trajectory_cells_file)
        trajectory_cells = pd.read_csv(trajectory_cells_file)

    verified = None
    if os.path.isfile(verified_file) and os.path.getsize(verified_file) > 1:
        logger.info("Reading %s", verified_file)
        verified = pd.read_csv(verified_file, parse_dates=["verified_at"])

    # Harvest audit CSVs are produced by the harvester's run lifecycle and
    # feed the harvest-dashboard service. Optional so old harvest folders
    # (pre-dashboard) still load cleanly.
    harvest_runs_df = None
    harvest_attempts_df = None
    if os.path.isfile(harvest_runs_file):
        logger.info("Reading %s", harvest_runs_file)
        harvest_runs_df = pd.read_csv(
            harvest_runs_file, parse_dates=["started_at", "finished_at"]
        )
    if os.path.isfile(harvest_attempts_file):
        logger.info("Reading %s", harvest_attempts_file)
        harvest_attempts_df = pd.read_csv(
            harvest_attempts_file, parse_dates=["attempted_at"]
        )

    datasets["eovs"] = datasets["eovs"].apply(ast.literal_eval)
    datasets["organizations"] = datasets["organizations"].apply(ast.literal_eval)
    datasets["profile_variables"] = datasets["profile_variables"].apply(
        ast.literal_eval
    )
    if "obis_nodes" in datasets.columns:
        datasets["obis_nodes"] = datasets["obis_nodes"].apply(
            lambda x: (
                ast.literal_eval(x)
                if isinstance(x, str)
                else (x if isinstance(x, list) else [])
            )
        )
    else:
        datasets["obis_nodes"] = [[] for _ in range(len(datasets))]

    if datasets.empty:
        if not incremental:
            # A full reload with zero datasets would TRUNCATE everything and
            # leave the DB empty — genuinely wrong, so bail out hard.
            logger.info("No datasets found")
            sys.exit(1)
        # Incremental runs legitimately produce an empty datasets.csv when every
        # dataset was unchanged and skipped by the harvester (skip_unchanged).
        # That is a successful no-op, not a crash: fall through so we still bump
        # verified_at for the unchanged datasets and append the harvest audit rows.
        logger.info(
            "No changed datasets in incremental run; "
            "skipping dataset load, will still bump verified_at and write harvest audit"
        )

    schema = "cde"

    def acquire_loader_lock():
        # Transaction-scoped lock that serializes loads over the shared cde tables.
        # See DB_LOADER_ADVISORY_LOCK_KEY for why this is acquired late (incremental)
        # vs up-front (full reload). Concurrent loaders simply wait here until the one
        # ahead commits/rolls back.
        logger.info("Acquiring db-loader advisory lock (serializes concurrent loads)")
        transaction.execute(
            text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": DB_LOADER_ADVISORY_LOCK_KEY},
        )

    with engine.begin() as transaction:
        logger.info("Writing to DB:")

        # Pre-fetch scientific_name → aphia_id mappings from existing
        # vernaculars so prepare_obis_cells_dataframe can populate
        # obis_cells.aphia_ids at COPY time. The post-load
        # obis_backfill_aphia_ids() still runs to cover names that weren't yet
        # in the vernaculars table when we fetched. The vernaculars table
        # survives full reloads (not in remove_all_data's TRUNCATE list).
        name_to_aphia = {}
        if obis_cells is not None:
            with _timed("fetch vernaculars for aphia_ids preload", logger):
                rows = transaction.execute(
                    text(
                        "SELECT scientific_name, aphia_id "
                        "FROM cde.scientific_name_vernaculars "
                        "WHERE aphia_id IS NOT NULL"
                    )
                ).all()
                name_to_aphia = dict(rows)
                logger.info("Pre-fetched %d name→aphia_id mappings", len(name_to_aphia))

        if incremental:
            logger.info(
                "Using INCREMENTAL mode - will load to temp tables, process, then UPSERT"
            )

            # Incremental approach using temporary tables:
            # 1. Load all data into temporary tables (no constraints)
            # 2. Run all processing functions on temp tables
            # 3. UPSERT from temp tables into main tables

            # Create temporary tables that mirror the main tables structure WITHOUT constraints
            logger.info("Creating temporary tables")
            transaction.execute(text("SELECT create_temp_tables();"))

            # Load data into temp tables
            datasets = ensure_organization_pks(datasets)
            if not datasets.empty:
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
                prepared = prepare_obis_cells_dataframe(obis_cells, name_to_aphia)
                with _timed("temp_obis_cells COPY", logger):
                    logger.info(
                        "Loading obis_cells into temp table (%d rows)", len(prepared)
                    )
                    load_cells_copy(prepared, "temp_obis_cells", transaction)

            if trajectory_cells is not None:
                prepared = prepare_trajectory_cells_dataframe(trajectory_cells)
                with _timed("temp_trajectory_cells COPY", logger):
                    logger.info(
                        "Loading trajectory_cells into temp table (%d rows)",
                        len(prepared),
                    )
                    load_cells_copy(prepared, "temp_trajectory_cells", transaction)

            if not skipped_datasets.empty:
                with _timed("temp_skipped_datasets to_sql", logger):
                    logger.info("Loading skipped_datasets into temp table")
                    skipped_datasets.to_sql(
                        "temp_skipped_datasets",
                        con=transaction,
                        if_exists="append",
                        index=False,
                        method="multi",
                    )

            # Temp-table uploads above are session-private and contend with nothing,
            # so they ran lock-free. Take the lock now: process_incremental_update()
            # is the phase that touches the shared cde tables (drop/set constraints,
            # DELETE/INSERT) and must not interleave with another load or the
            # full-reload TRUNCATE. The lock auto-releases at COMMIT, covering the
            # harvest-audit appends below and the commit itself.
            acquire_loader_lock()

            # Process and UPSERT all data using SQL functions
            with _timed("process_incremental_update", logger):
                logger.info("Running incremental update")
                transaction.execute(text("SELECT process_incremental_update();"))
                logger.info("Incremental update complete")

            # Skipped-unchanged datasets: advance only verified_at.
            if verified is not None and not verified.empty:
                with _timed("verified_at bump", logger):
                    logger.info("Bumping verified_at for %d unchanged datasets", len(verified))
                    transaction.execute(text(
                        "CREATE TEMP TABLE temp_verified "
                        "(erddap_url text, dataset_id text, verified_at timestamptz) "
                        "ON COMMIT DROP"
                    ))
                    verified[["erddap_url", "dataset_id", "verified_at"]].to_sql(
                        "temp_verified",
                        con=transaction,
                        if_exists="append",
                        index=False,
                        method="multi",
                    )
                    transaction.execute(text(
                        "UPDATE cde.datasets d SET verified_at = v.verified_at "
                        "FROM temp_verified v "
                        "WHERE d.dataset_id = v.dataset_id "
                        "AND d.erddap_url = v.erddap_url"
                    ))

        else:
            # Original full reload logic
            logger.info("Using FULL RELOAD mode - will clear all data")

            # A full reload TRUNCATEs the shared cde tables from the start, so it
            # must hold the lock for its ENTIRE transaction (unlike the incremental
            # path, which acquires it late). Take it before the guard read so the
            # whole reload sees a consistent, serialized view.
            acquire_loader_lock()

            # Full-reload guard (defense-in-depth behind cde_pipeline's
            # force-incremental). Refuse to TRUNCATE when the incoming harvest
            # covers fewer sources than the DB already holds — the signature of
            # a single-source run wrongly taking the full-reload path, which
            # would wipe every other source. A legitimate full reload after a
            # source was removed from config is rarer; set CDE_ALLOW_FULL_RELOAD=1
            # to permit it (it then prunes the removed source).
            incoming_sources = set(datasets["erddap_url"].dropna().unique())
            existing_sources = {
                r[0]
                for r in transaction.execute(
                    text("SELECT DISTINCT erddap_url FROM cde.datasets")
                ).all()
            }
            allow_full = os.environ.get("CDE_ALLOW_FULL_RELOAD", "").lower() in (
                "1",
                "true",
                "yes",
            )
            missing = existing_sources - incoming_sources
            if existing_sources and missing and not allow_full:
                raise RuntimeError(
                    f"Refusing full reload: this harvest covers {len(incoming_sources)} "
                    f"source(s) but cde.datasets holds {len(existing_sources)}, missing "
                    f"e.g. {sorted(missing)[:3]}. A full reload would TRUNCATE those. "
                    "Use incremental mode for a partial harvest, or set "
                    "CDE_ALLOW_FULL_RELOAD=1 to intentionally prune."
                )

            # Session-level tuning for the bulk rebuild. SET LOCAL confines these
            # to the current transaction. synchronous_commit=OFF is acceptable
            # here because the rebuild is replayable from the harvest CSVs if
            # the COMMIT is lost; do NOT apply this in the incremental path.
            transaction.execute(
                text("""
                SET LOCAL work_mem = '256MB';
                SET LOCAL maintenance_work_mem = '1GB';
                SET LOCAL synchronous_commit = OFF;
                SET LOCAL temp_buffers = '256MB';
            """)
            )

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
                prepared = prepare_obis_cells_dataframe(obis_cells, name_to_aphia)
                with _timed("obis_cells COPY", logger):
                    logger.info("Writing obis_cells (%d rows)", len(prepared))
                    load_cells_copy(
                        prepared, "obis_cells", transaction, schema=schema
                    )

            if trajectory_cells is not None:
                prepared = prepare_trajectory_cells_dataframe(trajectory_cells)
                # Resolve dataset_pk at COPY time (datasets were just written
                # above) so trajectory_link_dataset_pk() doesn't rewrite every
                # row post-load. Unmatched rows COPY a NULL and are caught by
                # that backfill pass.
                pk_rows = transaction.execute(
                    text("SELECT pk, erddap_url, dataset_id FROM cde.datasets")
                ).all()
                pk_map = {(r.erddap_url, r.dataset_id): r.pk for r in pk_rows}
                prepared["dataset_pk"] = pd.array(
                    [
                        pk_map.get(key)
                        for key in zip(
                            prepared["erddap_url"], prepared["dataset_id"]
                        )
                    ],
                    dtype="Int64",
                )
                with _timed("trajectory_cells COPY", logger):
                    logger.info("Writing trajectory_cells (%d rows)", len(prepared))
                    load_cells_copy(
                        prepared, "trajectory_cells", transaction, schema=schema
                    )

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
                # Per-step invocation (sub-functions defined in 5_profile_process.sql)
                # so each gets its own _timed log line and row-count info. The
                # incremental path still calls the obis_process() wrapper.
                # FALSE on obis_refresh_matviews = non-concurrent refresh. Safe in
                # a full rebuild (web-api is stopped, no readers to protect) and
                # avoids CONCURRENTLY's diff-and-swap overhead.
                obis_steps = [
                    ("obis_set_geom", "()"),
                    ("obis_link_dataset_pk", "()"),
                    ("obis_insert_points", "()"),
                    ("obis_link_point_pk", "()"),
                    ("obis_update_n_profiles", "()"),
                    ("obis_refresh_matviews", "(FALSE)"),
                    ("obis_backfill_aphia_ids", "()"),
                ]
                logger.info("Processing obis_cells")
                for fn, args in obis_steps:
                    with _timed(fn, logger):
                        n = transaction.execute(text(f"SELECT {fn}{args};")).scalar()
                        logger.info(
                            "  %s: %s rows affected", fn, n if n is not None else 0
                        )

            if trajectory_cells is not None:
                # Per-step invocation for timing/row-count logs (sub-functions
                # in 5_profile_process.sql); incremental calls the
                # trajectory_process() wrapper instead. Must run after
                # profile_process() (points rebuild) and before create_hexes()
                # (which links point_pk + hex FKs in one pass). The two steps
                # here are backfills that should touch ~0 rows: dataset_pk is
                # set at COPY time above, days at harvest time.
                trajectory_steps = [
                    "trajectory_link_dataset_pk",
                    "trajectory_insert_points",
                    "trajectory_update_days",
                ]
                logger.info("Processing trajectory_cells")
                for fn in trajectory_steps:
                    with _timed(fn, logger):
                        n = transaction.execute(text(f"SELECT {fn}();")).scalar()
                        logger.info(
                            "  %s: %s rows affected", fn, n if n is not None else 0
                        )

            with _timed("create_hexes", logger):
                logger.info("Creating hexes")
                transaction.execute(text("SELECT create_hexes();"))

            with _timed("set_constraints", logger):
                # This ensures that all fields were set successfully
                logger.info("Setting constraints")
                transaction.execute(text("SELECT set_constraints();"))

        # Harvest audit: append-only. Same writes in both incremental and
        # full-reload paths since these tables are never truncated.
        if harvest_runs_df is not None and not harvest_runs_df.empty:
            with _timed("harvest_runs to_sql", logger):
                logger.info("Writing harvest_runs (%d rows)", len(harvest_runs_df))
                harvest_runs_df.to_sql(
                    "harvest_runs",
                    con=transaction,
                    if_exists="append",
                    schema=schema,
                    index=False,
                    method="multi",
                )
        if harvest_attempts_df is not None and not harvest_attempts_df.empty:
            with _timed("harvest_attempts to_sql", logger):
                logger.info(
                    "Writing harvest_attempts (%d rows)", len(harvest_attempts_df)
                )
                harvest_attempts_df.to_sql(
                    "harvest_attempts",
                    con=transaction,
                    if_exists="append",
                    schema=schema,
                    index=False,
                    method="multi",
                )

        logger.info("Wrote to db: %s", f"{schema}.datasets")
        logger.info("Wrote to db: %s", f"{schema}.profiles")
        logger.info("Wrote to db: %s", f"{schema}.skipped_datasets")
        if harvest_runs_df is not None:
            logger.info("Wrote to db: %s", f"{schema}.harvest_runs")
        if harvest_attempts_df is not None:
            logger.info("Wrote to db: %s", f"{schema}.harvest_attempts")

    # Post-commit maintenance (VACUUM can't run inside the transaction).
    # Every load leaves one dead version per rewritten row (create_hexes()
    # relinks point_pk/hex FKs on all cells tables), and incremental loads add
    # DELETE+INSERT churn. Vacuuming right away keeps that space reusable so
    # the tables plateau instead of growing run-over-run, and refreshes
    # planner stats for the tile queries.
    if trajectory_cells is not None:
        with _timed("post-load VACUUM ANALYZE", logger):
            with engine.connect().execution_options(
                isolation_level="AUTOCOMMIT"
            ) as conn:
                conn.execute(text("VACUUM ANALYZE cde.trajectory_cells"))
