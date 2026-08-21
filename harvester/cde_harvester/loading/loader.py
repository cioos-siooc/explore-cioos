import ast
import csv
import io
import logging
import os
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
# incremental loads can't fight over each other's DELETE/INSERT churn.
#
# The lock is NOT taken at the top of the load. Incremental loads first populate
# session-private temp tables WITHOUT the lock, then acquire it only around
# process_incremental_update() — the phase that actually touches the shared
# tables. This keeps the lock held for minutes, not the whole bulk upload
# (~tens of minutes), so concurrent loaders upload in parallel and only
# serialize on the short processing phase.
#
# CRITICAL ORDERING INVARIANT: the staging phase runs in its OWN transaction,
# COMMITTED before the advisory lock is requested (see acquire_loader_lock).
# The staging phase is not lock-free — create_temp_tables()'s
# CREATE TEMP TABLE (LIKE cde.X) takes AccessShareLock on every shared source
# table, held to transaction end — while the locked phase takes
# AccessExclusiveLock on the same tables (drop_constraints ALTERs). If a
# loader could WAIT on the advisory lock while still HOLDING staging locks,
# the advisory-lock holder's AccessExclusive requests would queue behind
# those AccessShare locks: a circular wait. A live three-loader deadlock
# (two DeadlockDetected + one aborted load) was traced to exactly that.
# Committing the staging transaction first releases every lock the session
# holds, so a loader waiting on the advisory lock holds nothing. Temp tables
# and their rows survive the commit (session-scoped, ON COMMIT PRESERVE ROWS).
#
# Full reloads take the lock before any shared-table access in their phase.
# A late-acquiring incremental is still correct: the full-reload holds the same
# lock, so the worst case is the incremental simply waits behind it.
# pg_advisory_xact_lock auto-releases at COMMIT/ROLLBACK. Arbitrary stable
# constant ("CDE-LOADER").
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
    # would otherwise slip through and fail validate_loaded_data().
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

    # Same bigint/COPY constraint as prepare_trajectory_days_dataframe.
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
    """Bulk-load a cells DataFrame (obis_cells / trajectory_days) via COPY
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


def prepare_trajectory_days_dataframe(trajectory_days):
    """Clean and prepare the trajectory_days DataFrame for insertion.

    Deduplicates on the table's unique key, aggregating counts and depth
    extents defensively (a dataset harvested in two passes can produce the
    same trajectory-day twice).
    """
    days = trajectory_days.copy()
    days["trajectory_id"] = days["trajectory_id"].fillna("").astype(str)
    # date, not timestamp: the day column is a DATE in the DB, and a stray
    # time-of-day would split one day into two rows.
    days["day"] = pd.to_datetime(days["day"], errors="coerce", utc=True).dt.date

    key_cols = ["erddap_url", "dataset_id", "trajectory_id", "day"]
    agg = (
        days.groupby(key_cols, dropna=False)
        .agg(
            n_records=("n_records", "sum"),
            n_profiles=("n_profiles", "sum"),
            depth_min=("depth_min", "min"),
            depth_max=("depth_max", "max"),
        )
        .reset_index()
    )
    # COPY does no casting: these land in bigint columns, and pandas upcasts
    # counts to float64 ("2.0") as soon as a NaN is involved anywhere upstream.
    # Nullable Int64 renders as "2" / \N in the COPY buffer.
    for col in ("n_records", "n_profiles"):
        agg[col] = agg[col].round().astype("Int64")
    return agg


def prepare_trajectory_points_dataframe(trajectory_points):
    """Clean and prepare trajectory_points DataFrame for insertion.

    Unlike the cells tables nothing is aggregated or rounded — these are raw
    ordered fixes. Parse times, drop unusable rows, and deduplicate on the
    table's unique key (erddap_url, dataset_id, trajectory_id, time).
    """
    points = trajectory_points.copy()
    points["trajectory_id"] = points["trajectory_id"].fillna("").astype(str)
    points["time"] = pd.to_datetime(points["time"], errors="coerce", utc=True)
    points = points.dropna(subset=["time", "latitude", "longitude"])
    if "profile_id" in points.columns:
        points["profile_id"] = points["profile_id"].astype("string")
        points.loc[points["profile_id"].str.strip() == "", "profile_id"] = pd.NA
    else:
        points["profile_id"] = pd.NA

    key_cols = ["erddap_url", "dataset_id", "trajectory_id", "time"]
    points = (
        points.sort_values(key_cols)
        .drop_duplicates(subset=key_cols, keep="first")
        .reset_index(drop=True)
    )
    return points[
        ["erddap_url", "dataset_id", "trajectory_id", "profile_id",
         "time", "latitude", "longitude"]
    ]


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

# timeout_seconds: hard ceiling well above any observed load (full reload incl.
# hex build runs tens of minutes). A run that exceeds it is genuinely wedged —
# Prefect marks it Failed instead of leaving it Running forever, complementing
# the server-side idle_in_transaction/lock timeouts set inside the transaction.
# No retries here on purpose: the transaction is atomic, but the next scheduled
# harvest re-covers the data anyway, and auto-retrying a resource-starved DB
# just piles on load.
@task(name="cde-db-loader", timeout_seconds=7200)
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
    trajectory_days_file = f"{folder}/trajectory_days.csv"
    trajectory_points_file = f"{folder}/trajectory_points.csv"
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

    trajectory_days = None
    if os.path.isfile(trajectory_days_file):
        logger.info("Reading %s", trajectory_days_file)
        trajectory_days = pd.read_csv(trajectory_days_file)

    trajectory_points = None
    if os.path.isfile(trajectory_points_file):
        logger.info("Reading %s", trajectory_points_file)
        trajectory_points = pd.read_csv(trajectory_points_file)

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

    # Griddap metadata columns. All nullable; absent entirely from
    # pre-griddap harvest folders. The jsonb columns arrive as Python-repr
    # strings (same CSV contract as eovs); NaN must become None or the JSONB
    # binding fails. coverage_time_* is parsed to datetime so NaT binds as
    # NULL on the timestamptz columns.
    for col in ("grid_variables", "grid_dimensions"):
        if col in datasets.columns:
            datasets[col] = datasets[col].apply(
                lambda x: ast.literal_eval(x) if isinstance(x, str) and x else None
            )
        else:
            datasets[col] = None
    for col in ("coverage_time_min", "coverage_time_max"):
        if col not in datasets.columns:
            datasets[col] = pd.NaT
        datasets[col] = pd.to_datetime(datasets[col], utc=True, errors="coerce")
    for col in (
        "coverage_lat_min", "coverage_lat_max",
        "coverage_lon_min", "coverage_lon_max",
        "coverage_depth_min", "coverage_depth_max",
    ):
        if col not in datasets.columns:
            datasets[col] = None
    if "wms_url" not in datasets.columns:
        datasets["wms_url"] = None

    if datasets.empty:
        if not incremental:
            # A full reload with zero datasets would TRUNCATE everything and
            # leave the DB empty — genuinely wrong, so bail out hard. Raise,
            # don't sys.exit: this also runs inside a Prefect flow, where
            # SystemExit reports as "Crashed" instead of a clean Failed (the
            # CLI wrapper in loading/__main__.py handles the exit code).
            raise RuntimeError(
                "Full reload found no datasets; refusing to wipe the database"
            )
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
        #
        # Commit the staging transaction FIRST: it releases every lock this
        # session holds (notably create_temp_tables' AccessShareLock on the
        # shared tables it LIKEs), so no loader ever waits on the advisory
        # lock while holding a shared-table lock — the lock-order inversion
        # behind a live three-loader deadlock. Temp tables and their rows are
        # session-scoped and survive the commit.
        if transaction.in_transaction():
            transaction.commit()
        # The advisory-lock wait is expected to exceed the session lock_timeout
        # (set at transaction start), so lift the timeout for this one statement
        # and restore it after. A zombie lock-holder can't wedge us: its
        # idle_in_transaction_session_timeout kills it and releases the lock.
        logger.info("Acquiring db-loader advisory lock (serializes concurrent loads)")
        transaction.execute(text("SET lock_timeout = 0"))
        transaction.execute(
            text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": DB_LOADER_ADVISORY_LOCK_KEY},
        )
        transaction.execute(text("SET lock_timeout = '2min'"))

    # "Commit as you go" connection, NOT engine.begin(): the load is two
    # transactions — a session-private staging phase (temp tables + uploads,
    # plus the vernaculars prefetch), committed inside acquire_loader_lock(),
    # then the advisory-locked shared-table phase, committed at the end. A
    # staging failure aborts before any shared-table change; a locked-phase
    # failure rolls back the shared-table work while the already-committed
    # staging leaves nothing behind (temp tables die with the session).
    with engine.connect() as transaction:
        logger.info("Writing to DB:")

        # Session-level safety timeouts for the load transaction.
        #
        # idle_in_transaction_session_timeout: if this container dies mid-load
        # (redeploy, OOM-kill) Postgres can keep the session alive as
        # idle-in-transaction, holding the advisory lock — which would queue every
        # future harvest forever at acquire_loader_lock(). 10 min never fires
        # during real work (the gaps between Python-driven statements are
        # milliseconds) but auto-kills such orphans, rolling their transaction back.
        #
        # lock_timeout: the load path is pure DML and normally never waits on
        # DDL, but a manual psql ALTER, a live-applied migration, or pg_repack
        # can still queue it indefinitely and silently. 2 min turns that into a
        # clean, logged failure Prefect can surface. NOTE: lock_timeout also
        # governs pg_advisory_xact_lock() waits, and a loader legitimately
        # waiting behind another load may need far longer than 2 min —
        # acquire_loader_lock() temporarily lifts the timeout for exactly that
        # wait (the zombie-holder case is covered by the idle timeout above,
        # so the wait still can't be infinite in practice).
        transaction.execute(
            text(
                "SET idle_in_transaction_session_timeout = '10min'; "
                "SET lock_timeout = '2min';"
            )
        )

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

            # Deprioritize this load relative to live web-api traffic: without
            # this, the merge phase's larger scans can fan out across every
            # core and starve public queries. Single-threaded is fine here —
            # the processing phase is delta-sized — and the full-reload path
            # deliberately keeps parallelism (it runs with the site down).
            transaction.execute(text("SET max_parallel_workers_per_gather = 0"))

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

            if trajectory_days is not None:
                prepared = prepare_trajectory_days_dataframe(trajectory_days)
                with _timed("temp_trajectory_days COPY", logger):
                    logger.info(
                        "Loading trajectory_days into temp table (%d rows)",
                        len(prepared),
                    )
                    load_cells_copy(prepared, "temp_trajectory_days", transaction)

            if trajectory_points is not None:
                prepared = prepare_trajectory_points_dataframe(trajectory_points)
                with _timed("temp_trajectory_points COPY", logger):
                    logger.info(
                        "Loading trajectory_points into temp table (%d rows)",
                        len(prepared),
                    )
                    load_cells_copy(prepared, "temp_trajectory_points", transaction)

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
            # is the phase that touches the shared cde tables (DELETE/INSERT churn)
            # and must not interleave with another load or the full-reload TRUNCATE.
            # It runs as pure DML (no ACCESS EXCLUSIVE DDL), so it no longer
            # deadlocks with live web-api readers. The lock auto-releases at COMMIT,
            # covering the harvest-audit appends below and the commit itself.
            acquire_loader_lock()

            # Process and UPSERT all data using SQL functions
            with _timed("process_incremental_update", logger):
                logger.info("Running incremental update")
                transaction.execute(text("SELECT process_incremental_update();"))
                logger.info("Incremental update complete")

            # Skipped-unchanged datasets: advance only verified_at.
            # IF NOT EXISTS because prune_stale_datasets() below reads
            # temp_verified as part of the run's coverage and creates it empty
            # when this block didn't run first.
            if verified is not None and not verified.empty:
                with _timed("verified_at bump", logger):
                    logger.info("Bumping verified_at for %d unchanged datasets", len(verified))
                    transaction.execute(text(
                        "CREATE TEMP TABLE IF NOT EXISTS temp_verified "
                        "(erddap_url text, dataset_id text, verified_at timestamptz)"
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

            # Prune datasets that disappeared upstream. A harvest fully
            # enumerates each source it covers (changed -> temp_datasets,
            # unchanged -> temp_verified, errored/filtered -> temp_skipped),
            # so anything of a covered source in none of the three is gone
            # upstream. This gives incremental loads full-reload semantics
            # without the TRUNCATE, so routine runs never need the full-reload
            # path (and its site-blocking ACCESS EXCLUSIVE lock) at all. A
            # per-source guard inside the function refuses mass-removals
            # (> 50% of a source) as a harvester-bug precaution.
            if os.environ.get("CDE_PRUNE_STALE", "1").lower() not in ("0", "false", "no"):
                with _timed("prune_stale_datasets", logger):
                    n_pruned = transaction.execute(
                        text("SELECT prune_stale_datasets();")
                    ).scalar()
                    if n_pruned:
                        logger.info("Pruned %d dataset(s) no longer present upstream", n_pruned)

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

            # No drop_constraints() step: the backfilled columns are permanently
            # NULL-able and the hex FKs are DEFERRABLE INITIALLY DEFERRED (checked
            # at COMMIT), so nothing needs toggling before the load. See
            # 7_contraints.sql / validate_loaded_data().
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

            if trajectory_days is not None or trajectory_points is not None:
                # Resolve dataset_pk at COPY time (datasets were just written
                # above) so the *_link_dataset_pk() passes don't rewrite every
                # row post-load. Unmatched rows COPY a NULL and are caught by
                # those backfill passes.
                pk_rows = transaction.execute(
                    text("SELECT pk, erddap_url, dataset_id FROM cde.datasets")
                ).all()
                pk_map = {(r.erddap_url, r.dataset_id): r.pk for r in pk_rows}

            if trajectory_days is not None:
                prepared = prepare_trajectory_days_dataframe(trajectory_days)
                prepared["dataset_pk"] = pd.array(
                    [
                        pk_map.get(key)
                        for key in zip(
                            prepared["erddap_url"], prepared["dataset_id"]
                        )
                    ],
                    dtype="Int64",
                )
                with _timed("trajectory_days COPY", logger):
                    logger.info("Writing trajectory_days (%d rows)", len(prepared))
                    load_cells_copy(
                        prepared, "trajectory_days", transaction, schema=schema
                    )

            if trajectory_points is not None:
                prepared = prepare_trajectory_points_dataframe(trajectory_points)
                prepared["dataset_pk"] = pd.array(
                    [
                        pk_map.get(key)
                        for key in zip(
                            prepared["erddap_url"], prepared["dataset_id"]
                        )
                    ],
                    dtype="Int64",
                )
                with _timed("trajectory_points COPY", logger):
                    logger.info("Writing trajectory_points (%d rows)", len(prepared))
                    load_cells_copy(
                        prepared, "trajectory_points", transaction, schema=schema
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

            if trajectory_days is not None:
                # dataset_pk backfill only (~0 rows: it is set at COPY time
                # above). Per-step invocation for timing/row-count logs;
                # incremental calls the trajectory_process() wrapper instead.
                logger.info("Processing trajectory_days")
                with _timed("trajectory_link_dataset_pk", logger):
                    n = transaction.execute(
                        text("SELECT trajectory_link_dataset_pk();")
                    ).scalar()
                    logger.info(
                        "  trajectory_link_dataset_pk: %s rows affected",
                        n if n is not None else 0,
                    )

            if trajectory_points is not None:
                # dataset_pk backfill (~0 rows, set at COPY time), the
                # per-trajectory summary rebuild for /tiles/tracks pruning and
                # the platform list, then the hex sweep that turns these tracks
                # into the map's coverage layer. Order matters: the sweep takes
                # each trajectory's gap threshold from track_stats, and joins
                # cde.trajectory_days (COPYed above) for the attributes.
                # NULL = whole corpus; the incremental path scopes it to the
                # datasets it touched.
                trajectory_point_steps = [
                    "trajectory_points_link_dataset_pk",
                    "trajectory_refresh_track_stats",
                    "trajectory_build_hexes",
                ]
                logger.info("Processing trajectory_points")
                for fn in trajectory_point_steps:
                    with _timed(fn, logger):
                        n = transaction.execute(text(f"SELECT {fn}();")).scalar()
                        logger.info(
                            "  %s: %s rows affected", fn, n if n is not None else 0
                        )

            with _timed("create_hexes", logger):
                logger.info("Creating hexes")
                transaction.execute(text("SELECT create_hexes();"))

            with _timed("validate_loaded_data", logger):
                # Ensures every required field was populated (replaces the old
                # set_constraints() NOT NULL re-add). A plain SELECT — the hex FKs
                # are validated by the DEFERRABLE constraint at COMMIT.
                logger.info("Validating loaded data")
                transaction.execute(text("SELECT validate_loaded_data();"))

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

        # Commit the locked phase (engine.connect() does not auto-commit the
        # way engine.begin() did); this also releases the advisory lock.
        if transaction.in_transaction():
            transaction.commit()

        logger.info("Wrote to db: %s", f"{schema}.datasets")
        logger.info("Wrote to db: %s", f"{schema}.profiles")
        logger.info("Wrote to db: %s", f"{schema}.skipped_datasets")
        if harvest_runs_df is not None:
            logger.info("Wrote to db: %s", f"{schema}.harvest_runs")
        if harvest_attempts_df is not None:
            logger.info("Wrote to db: %s", f"{schema}.harvest_attempts")

    # Post-commit maintenance, part 1: GC of orphaned points/hex cells.
    # cde.points and hexes_zoom_* are append-only during loads (stable pks);
    # rows orphaned by shrinking/removed datasets are collected here instead,
    # OUTSIDE the load transaction so they never extend it. Runs under the
    # loader advisory lock so it can't interleave with another load's linking
    # phase — but with try-lock: if another load is already queued/running,
    # skip and let a later run collect (orphans are invisible to the API
    # meanwhile, so deferral is free).
    with engine.begin() as tx:
        got_lock = tx.execute(
            text("SELECT pg_try_advisory_xact_lock(:k)"),
            {"k": DB_LOADER_ADVISORY_LOCK_KEY},
        ).scalar()
        if got_lock:
            with _timed("gc_orphan_points_and_hexes", logger):
                n_gc = tx.execute(
                    text("SELECT gc_orphan_points_and_hexes();")
                ).scalar()
                logger.info("GC removed %d orphaned point/hex row(s)", n_gc)
        else:
            logger.info("Skipping orphan GC: another load holds the loader lock")

    # Post-commit maintenance (VACUUM can't run inside the transaction).
    # Every load leaves one dead version per rewritten row (create_hexes()
    # relinks point_pk/hex FKs on all cells tables), and incremental loads add
    # DELETE+INSERT churn. Vacuuming right away keeps that space reusable so
    # the tables plateau instead of growing run-over-run, and refreshes
    # planner stats for the tile queries.
    if trajectory_days is not None or trajectory_points is not None:
        # Announce before starting: VACUUM emits no output until it finishes, so
        # without this line a multi-minute vacuum right after the final "Wrote to
        # db" logs looks like a hung run.
        vacuum_targets = ", ".join(
            name
            for name, present in (
                ("cde.trajectory_hexes", trajectory_points is not None),
                ("cde.trajectory_days", trajectory_days is not None),
                ("cde.trajectory_points", trajectory_points is not None),
            )
            if present
        )
        logger.info(
            "Data committed. Running post-load VACUUM ANALYZE on %s "
            "(may take several minutes, no output until done)",
            vacuum_targets,
        )
        with _timed("post-load VACUUM ANALYZE", logger):
            with engine.connect().execution_options(
                isolation_level="AUTOCOMMIT"
            ) as conn:
                if trajectory_points is not None:
                    conn.execute(text("VACUUM ANALYZE cde.trajectory_hexes"))
                if trajectory_days is not None:
                    conn.execute(text("VACUUM ANALYZE cde.trajectory_days"))
                if trajectory_points is not None:
                    conn.execute(text("VACUUM ANALYZE cde.trajectory_points"))
