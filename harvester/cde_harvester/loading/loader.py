import ast
import csv
import io
import json
import logging
import os
import time
from contextlib import contextmanager

import numpy as np
import pandas as pd
from prefect import get_run_logger, task
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB

from cde_harvester.core import errors
from cde_harvester.core.day_sets import (
    ranges_from_iso,
    ranges_to_pg_literal,
    ranges_to_psycopg,
)
from cde_harvester.core.db import create_db_engine, db_host
from cde_harvester.core.obis_cells import merge_cells
from cde_harvester.core.observability import init_sentry
from cde_harvester.core.schemas import (
    DATASET_ARRAY_DTYPES,
    PROFILE_ARRAY_DTYPES,
)

logging.getLogger("urllib3").setLevel(logging.WARNING)

# Transaction-scoped advisory lock serializing loads over the shared cde tables.
# Incremental loads stage into temp tables without it and take it only around
# process_incremental_update(), so concurrent loaders upload in parallel.
# INVARIANT: the staging transaction must be COMMITTED before requesting the
# lock (see acquire_loader_lock): CREATE TEMP TABLE (LIKE cde.X) holds
# AccessShareLock on the shared tables, and waiting on the advisory lock while
# holding it deadlocks against the holder's AccessExclusive requests (seen live
# with three loaders). Temp tables survive the commit (ON COMMIT PRESERVE ROWS).
# Arbitrary stable constant ("CDE-LOADER").
DB_LOADER_ADVISORY_LOCK_KEY = 738825001

# Without a chunksize, to_sql(method="multi") renders EVERY row into one
# client-side SQL string — the loader's largest allocation at 100K+ profiles.
SQL_INSERT_CHUNKSIZE = 5000

logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(levelname)-8s - %(name)s : %(message)s"
)

logger = logging.getLogger()


init_sentry()


def parse_day_ranges(value):
    """A day_ranges cell (repr'd list of ISO pairs from the CSV, or the live
    list in-process) -> list of (date, date) runs."""
    # NaN is truthy, so `value or []` would let a missing cell through.
    if isinstance(value, str):
        value = ast.literal_eval(value)
    if not isinstance(value, (list, tuple)):
        return []
    return ranges_from_iso(value)


def prepare_profiles_dataframe(profiles):
    profiles = profiles.replace("", np.NaN)
    # to_sql binds parameters, and psycopg2 adapts a list of strings as text[],
    # which PostgreSQL refuses for a daterange[] column; DateRange adapts.
    if "day_ranges" in profiles.columns:
        profiles["day_ranges"] = profiles["day_ranges"].apply(
            lambda value: ranges_to_psycopg(parse_day_ranges(value))
        )
    # Both time bounds are NOT NULL in cde.profiles: a time_max that passes the
    # harvester's null check but fails parse_erddap_dates' coerce becomes NaT.
    profiles = profiles.drop(
        columns=["altitude_min", "altitude_max", "scientific_names"], errors="ignore"
    ).dropna(subset=["time_min", "time_max"])
    return profiles


def prepare_obis_cells_dataframe(obis_cells, name_to_aphia=None):
    """``name_to_aphia`` fills aphia_ids at COPY time so the post-load
    obis_backfill_aphia_ids() UPDATE touches far fewer rows; it still picks up
    names absent from the dict."""
    obis_cells = obis_cells.copy()
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

    # Older CSVs have no day_ranges; the map falls back to the cell's span.
    has_day_ranges = "day_ranges" in obis_cells.columns
    if has_day_ranges:
        # merge_ranges unpacks (lo, hi) pairs; a raw CSV string would be
        # iterated per character.
        obis_cells["day_ranges"] = obis_cells["day_ranges"].apply(parse_day_ranges)

    agg = merge_cells(obis_cells, has_day_ranges=has_day_ranges)

    if name_to_aphia:

        def resolve(names):
            return sorted({name_to_aphia[n] for n in names if n in name_to_aphia})

        agg["aphia_ids"] = agg["scientific_names"].apply(resolve)
    else:
        agg["aphia_ids"] = [[] for _ in range(len(agg))]

    # Same bigint/COPY constraint as prepare_trajectory_days_dataframe.
    agg["n_records"] = agg["n_records"].round().astype("Int64")
    agg["days"] = agg["days"].round().astype("Int64")
    return agg


@contextmanager
def _timed(name, log):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        log.info("Step '%s' took %.1fs", name, time.perf_counter() - t0)


def _pg_text_array(values):
    def quote(s):
        return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'

    return "{" + ",".join(quote(v) for v in values) + "}"


def _pg_int_array(values):
    if not values:
        return "{}"
    return "{" + ",".join(str(int(v)) for v in values) + "}"


class _RowStream:
    """File-like read(size) over an iterator of CSV lines, so copy_expert
    streams rows instead of holding a full text copy of the frame in memory."""

    def __init__(self, lines):
        self._lines = lines
        self._buf = ""

    def read(self, size=-1):
        if size is None or size < 0:
            rest, self._buf = self._buf, ""
            return rest + "".join(self._lines)
        while len(self._buf) < size:
            try:
                self._buf += next(self._lines)
            except StopIteration:
                break
        chunk, self._buf = self._buf[:size], self._buf[size:]
        return chunk

    def readline(self):
        while "\n" not in self._buf:
            try:
                self._buf += next(self._lines)
            except StopIteration:
                break
        line, sep, self._buf = self._buf.partition("\n")
        return line + sep


def load_cells_copy(df, table_name, transaction, schema=None):
    """COPY FROM STDIN: ~10-50x faster than to_sql() at 100K+ rows."""
    cols = list(df.columns)

    def rows():
        line = io.StringIO()
        writer = csv.writer(line, quoting=csv.QUOTE_MINIMAL)
        for row in df.itertuples(index=False, name=None):
            out = []
            for col, val in zip(cols, row, strict=True):
                if val is None or val is pd.NA or (isinstance(val, float) and pd.isna(val)):
                    out.append(r"\N")
                elif col == "scientific_names":
                    out.append(
                        _pg_text_array(val if isinstance(val, (list, tuple)) else [])
                    )
                elif col == "aphia_ids":
                    out.append(_pg_int_array(val if isinstance(val, (list, tuple)) else []))
                elif col == "day_ranges":
                    # COPY runs the column's input function, coercing the
                    # text literal to daterange[] (unlike to_sql).
                    out.append(
                        ranges_to_pg_literal(val if isinstance(val, (list, tuple)) else [])
                    )
                else:
                    out.append(val)
            writer.writerow(out)
            yield line.getvalue()
            line.seek(0)
            line.truncate(0)

    buf = _RowStream(rows())

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


load_obis_cells_copy = load_cells_copy


def prepare_trajectory_days_dataframe(trajectory_days):
    """Aggregates on the unique key: a dataset harvested in two passes can
    produce the same trajectory-day twice."""
    days = trajectory_days.copy()
    days["trajectory_id"] = days["trajectory_id"].fillna("").astype(str)
    # A stray time-of-day would split one DATE into two rows.
    days["day"] = pd.to_datetime(days["day"], errors="coerce", utc=True, format="ISO8601").dt.date

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
    points = trajectory_points.copy()
    points["trajectory_id"] = points["trajectory_id"].fillna("").astype(str)
    points["time"] = pd.to_datetime(points["time"], errors="coerce", utc=True, format="ISO8601")
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

def _read_run_audit(folder):
    """Either is None when absent (pre-dashboard harvest folders)."""
    runs_file = f"{folder}/harvest_runs.csv"
    attempts_file = f"{folder}/harvest_attempts.csv"
    # Text columns read as text: an all-numeric column ("500" error messages)
    # would otherwise parse as float and be stored as "500.0".
    runs = (
        pd.read_csv(
            runs_file,
            parse_dates=["started_at", "finished_at"],
            dtype={"run_id": str, "git_sha": str, "error_message": str},
        )
        if os.path.isfile(runs_file)
        else None
    )
    attempts = (
        pd.read_csv(
            attempts_file,
            parse_dates=["attempted_at"],
            dtype={
                "run_id": str, "dataset_id": str, "reason_code": str,
                "error_message": str, "query_urls": str, "warnings": str,
            },
        )
        if os.path.isfile(attempts_file)
        else None
    )
    return runs, attempts


def _append_run_audit(con, runs, attempts, schema="cde"):
    for table, df in (("harvest_runs", runs), ("harvest_attempts", attempts)):
        if df is None or df.empty:
            continue
        logger.info("Writing %s (%d rows)", table, len(df))
        dtype = None
        if "warnings" in df:
            # JSONB re-serializes its input, so pass the parsed list.
            df = df.assign(warnings=df["warnings"].map(
                lambda v: json.loads(v) if isinstance(v, str) and v else None
            ))
            dtype = {"warnings": JSONB(none_as_null=True)}
        df.to_sql(
            table,
            con=con,
            if_exists="append",
            schema=schema,
            index=False,
            method="multi",
            chunksize=SQL_INSERT_CHUNKSIZE,
            dtype=dtype,
        )


def record_failed_run(folder, error_message):
    """Write a failed run's audit rows so the harvest dashboard shows it.

    No loader lock: the audit tables are append-only. If the load rolled back,
    harvested datasets are reported as LOAD_FAILED; if it failed after its
    commit, only the run's status changes.
    """
    runs, attempts = _read_run_audit(folder)
    if runs is None or runs.empty:
        logger.warning("No harvest_runs.csv in %s; failed run not recorded", folder)
        return False

    run_ids = list(runs["run_id"].astype(str))
    finished_at = pd.Timestamp.now(tz="UTC")
    with create_db_engine().begin() as con:
        committed = con.execute(
            text(
                "UPDATE cde.harvest_runs SET status = 'failed',"
                " finished_at = :finished_at, error_message = :error_message"
                " WHERE run_id = ANY(CAST(:ids AS uuid[]))"
            ),
            {"ids": run_ids, "finished_at": finished_at, "error_message": error_message},
        ).rowcount
        if committed:
            return True

        harvest_failed = (runs["status"] == "failed").all()
        runs = runs.assign(
            status="failed",
            finished_at=finished_at,
            error_message=(
                runs["error_message"].fillna(error_message)
                if harvest_failed
                else error_message
            ),
        )
        if not harvest_failed and attempts is not None:
            harvested = attempts["status"] == "success"
            attempts.loc[harvested, "status"] = "error"
            attempts.loc[harvested, "reason_code"] = errors.LOAD_FAILED
            attempts.loc[harvested, "error_message"] = error_message
        _append_run_audit(con, runs, attempts)
    return True


# timeout well above any observed load (tens of minutes) so a wedged run fails.
# No retries: the next scheduled harvest re-covers the data, and retrying a
# resource-starved DB just piles on load.
@task(name="cde-db-loader", timeout_seconds=7200)
def main(folder, incremental=False):
    logger = get_run_logger()

    engine = create_db_engine()
    engine.connect()
    logger.info("Connected to %s", db_host())

    datasets_file = f"{folder}/datasets.csv"
    profiles_file = f"{folder}/profiles.csv"
    skipped_datasets_file = f"{folder}/skipped.csv"
    obis_cells_file = f"{folder}/obis_cells.csv"
    trajectory_days_file = f"{folder}/trajectory_days.csv"
    trajectory_points_file = f"{folder}/trajectory_points.csv"
    verified_file = f"{folder}/verified.csv"

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

    harvest_runs_df, harvest_attempts_df = _read_run_audit(folder)

    if "eovs" in profiles.columns:
        profiles["eovs"] = profiles["eovs"].apply(
            lambda x: ast.literal_eval(x) if isinstance(x, str) else []
        )

    datasets["eovs"] = datasets["eovs"].apply(ast.literal_eval)
    datasets["organizations"] = datasets["organizations"].apply(ast.literal_eval)
    datasets["profile_variables"] = datasets["profile_variables"].apply(
        ast.literal_eval
    )
    for col in ("obis_nodes", "organization_roles"):
        if col in datasets.columns:
            datasets[col] = datasets[col].apply(
                lambda x: (
                    ast.literal_eval(x)
                    if isinstance(x, str)
                    else (x if isinstance(x, list) else [])
                )
            )
        else:
            datasets[col] = [[] for _ in range(len(datasets))]

    # Absent from older harvest folders. NaN must become None or the JSONB
    # binding fails; NaT binds as NULL on the timestamptz columns.
    for col in ("table_variables", "grid_variables", "grid_dimensions", "metadata"):
        if col in datasets.columns:
            datasets[col] = datasets[col].apply(
                lambda x: ast.literal_eval(x) if isinstance(x, str) and x else None
            )
        else:
            datasets[col] = None
    for col in ("coverage_time_min", "coverage_time_max"):
        if col not in datasets.columns:
            datasets[col] = pd.NaT
        datasets[col] = pd.to_datetime(datasets[col], utc=True, errors="coerce", format="ISO8601")
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
            # Raise, don't sys.exit: in a Prefect flow SystemExit reports as
            # "Crashed" instead of Failed.
            raise RuntimeError(
                "Full reload found no datasets; refusing to wipe the database"
            )
        # Every dataset unchanged (skip_unchanged): still bump verified_at
        # and append the harvest audit rows.
        logger.info(
            "No changed datasets in incremental run; "
            "skipping dataset load, will still bump verified_at and write harvest audit"
        )

    n_pruned = 0
    n_gc = 0

    schema = "cde"

    def acquire_loader_lock():
        # Commit staging FIRST; see DB_LOADER_ADVISORY_LOCK_KEY.
        if transaction.in_transaction():
            transaction.commit()
        # The wait may exceed lock_timeout; a zombie holder is still killed by
        # its idle_in_transaction_session_timeout.
        logger.info("Acquiring db-loader advisory lock (serializes concurrent loads)")
        transaction.execute(text("SET lock_timeout = 0"))
        transaction.execute(
            text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": DB_LOADER_ADVISORY_LOCK_KEY},
        )
        transaction.execute(text("SET lock_timeout = '2min'"))

    # engine.connect(), not begin(): staging is committed inside
    # acquire_loader_lock(), then the locked phase commits at the end.
    with engine.connect() as transaction:
        logger.info("Writing to DB:")

        # idle_in_transaction: a container killed mid-load would otherwise
        # hold the advisory lock and queue every future harvest forever.
        # lock_timeout: turns a stray DDL lock (manual ALTER, pg_repack) into
        # a logged failure; acquire_loader_lock() lifts it for its own wait.
        transaction.execute(
            text(
                "SET idle_in_transaction_session_timeout = '10min'; "
                "SET lock_timeout = '2min';"
            )
        )

        # The vernaculars table survives full reloads (not TRUNCATEd).
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

            # Parallel scans would starve live web-api queries; the delta is
            # small. Full reloads keep parallelism (site is down).
            transaction.execute(text("SET max_parallel_workers_per_gather = 0"))

            logger.info("Creating temporary tables")
            transaction.execute(text("SELECT create_temp_tables();"))

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
                        chunksize=SQL_INSERT_CHUNKSIZE,
                    )

            if not profiles.empty:
                with _timed("temp_profiles to_sql", logger):
                    logger.info("Loading profiles into temp table")
                    prepare_profiles_dataframe(profiles).to_sql(
                        "temp_profiles",
                        con=transaction,
                        if_exists="append",
                        index=False,
                        dtype=PROFILE_ARRAY_DTYPES,
                        method="multi",
                        chunksize=SQL_INSERT_CHUNKSIZE,
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
                        chunksize=SQL_INSERT_CHUNKSIZE,
                    )

            acquire_loader_lock()

            with _timed("process_incremental_update", logger):
                logger.info("Running incremental update")
                transaction.execute(text("SELECT process_incremental_update();"))
                logger.info("Incremental update complete")

            # IF NOT EXISTS: prune_stale_datasets() creates temp_verified empty
            # when this block doesn't run.
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
                        chunksize=SQL_INSERT_CHUNKSIZE,
                    )
                    transaction.execute(text(
                        "UPDATE cde.datasets d SET verified_at = v.verified_at "
                        "FROM temp_verified v "
                        "WHERE d.dataset_id = v.dataset_id "
                        "AND d.erddap_url = v.erddap_url"
                    ))

            # A harvest fully enumerates each source it covers (temp_datasets,
            # temp_verified, temp_skipped), so a covered source's dataset in
            # none of them is gone upstream. The function refuses removing
            # > 50% of a source.
            if os.environ.get("CDE_PRUNE_STALE", "1").lower() not in ("0", "false", "no"):
                with _timed("prune_stale_datasets", logger):
                    n_pruned = transaction.execute(
                        text("SELECT prune_stale_datasets();")
                    ).scalar()
                    if n_pruned:
                        logger.info("Pruned %d dataset(s) no longer present upstream", n_pruned)

        else:
            logger.info("Using FULL RELOAD mode - will clear all data")

            acquire_loader_lock()

            # Defense-in-depth behind cde_pipeline's force-incremental: a
            # single-source run on this path would wipe every other source.
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

            # synchronous_commit=OFF is safe only because a full rebuild is
            # replayable from the CSVs; do NOT apply it to the incremental path.
            transaction.execute(
                text("""
                SET LOCAL work_mem = '256MB';
                SET LOCAL maintenance_work_mem = '1GB';
                SET LOCAL synchronous_commit = OFF;
                SET LOCAL temp_buffers = '256MB';
            """)
            )

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
                    chunksize=SQL_INSERT_CHUNKSIZE,
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
                        dtype=PROFILE_ARRAY_DTYPES,
                        method="multi",
                        chunksize=SQL_INSERT_CHUNKSIZE,
                    )

            if obis_cells is not None:
                prepared = prepare_obis_cells_dataframe(obis_cells, name_to_aphia)
                with _timed("obis_cells COPY", logger):
                    logger.info("Writing obis_cells (%d rows)", len(prepared))
                    load_cells_copy(
                        prepared, "obis_cells", transaction, schema=schema
                    )

            if trajectory_days is not None or trajectory_points is not None:
                # Resolved at COPY time so *_link_dataset_pk() doesn't rewrite
                # every row; unmatched NULLs are caught by that backfill.
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
                            prepared["erddap_url"], prepared["dataset_id"], strict=True
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
                            prepared["erddap_url"], prepared["dataset_id"], strict=True
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
                    chunksize=SQL_INSERT_CHUNKSIZE,
                )

            with _timed("profile_process", logger):
                logger.info("Processing new records")
                transaction.execute(text("SELECT profile_process();"))
            with _timed("ckan_process", logger):
                transaction.execute(text("SELECT ckan_process();"))

            if obis_cells is not None:
                # Per-step instead of obis_process() for timing logs. FALSE =
                # non-concurrent matview refresh: no readers during a rebuild.
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
                # Order matters: the hex sweep takes each trajectory's gap
                # threshold from track_stats.
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
                logger.info("Validating loaded data")
                transaction.execute(text("SELECT validate_loaded_data();"))

        with _timed("refresh_dataset_day_ranges", logger):
            transaction.execute(text("SELECT refresh_dataset_day_ranges();"))
        with _timed("refresh_hexes_zoom_0_rollup", logger):
            transaction.execute(text("SELECT refresh_hexes_zoom_0_rollup();"))

        with _timed("harvest audit to_sql", logger):
            _append_run_audit(transaction, harvest_runs_df, harvest_attempts_df)

        if transaction.in_transaction():
            transaction.commit()

        logger.info("Wrote to db: %s", f"{schema}.datasets")
        logger.info("Wrote to db: %s", f"{schema}.profiles")
        logger.info("Wrote to db: %s", f"{schema}.skipped_datasets")
        if harvest_runs_df is not None:
            logger.info("Wrote to db: %s", f"{schema}.harvest_runs")
        if harvest_attempts_df is not None:
            logger.info("Wrote to db: %s", f"{schema}.harvest_attempts")

    # Points/hexes are append-only during loads (stable pks); orphans are
    # collected outside the load transaction. Try-lock: if another load is
    # queued, a later run collects (orphans are invisible to the API).
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

    # Every load rewrites each row once (create_hexes relinks FKs); vacuuming
    # now keeps the tables from growing run-over-run.
    if trajectory_days is not None or trajectory_points is not None:
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
        with _timed("post-load VACUUM ANALYZE", logger), engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as conn:
            if trajectory_points is not None:
                conn.execute(text("VACUUM ANALYZE cde.trajectory_hexes"))
            if trajectory_days is not None:
                conn.execute(text("VACUUM ANALYZE cde.trajectory_days"))
            if trajectory_points is not None:
                conn.execute(text("VACUUM ANALYZE cde.trajectory_points"))

    # `changed` decides the redis flush; verified_at and audit rows don't
    # count (the dashboard routes have their own short TTLs).
    return {
        "changed": (not datasets.empty) or bool(n_pruned) or (not incremental),
        "changed_datasets": len(datasets),
        "pruned": n_pruned,
        "gc": n_gc,
        "full_reload": not incremental,
    }
