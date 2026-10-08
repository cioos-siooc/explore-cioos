"""Snapshot the database's harvested state into a loadable folder, and restore it.

A snapshot is what "Rebuild Database" needs to bring the site back without a
re-harvest. The harvested tables go out in the loader's own CSV format, so a
restore is an ordinary full load and every derived table (points, hexes,
trajectory hexes, track stats, matviews) is rebuilt by the load's SQL. The few
tables no load can rebuild go out in Postgres's COPY format and are restored
before the load.
"""

import csv
import json
import tempfile
from contextlib import contextmanager, suppress
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from cde_harvester.core import publish
from cde_harvester.core.day_sets import ranges_from_psycopg, ranges_to_csv_cell
from cde_harvester.core.schemas import (
    DatasetSchema,
    HarvestAttemptSchema,
    HarvestRunSchema,
    ObisCellSchema,
    ProfileSchema,
    SkippedDatasetSchema,
    TrajectoryDaySchema,
    TrajectoryPointSchema,
)
from cde_harvester.loading.loader import DB_LOADER_ADVISORY_LOCK_KEY


def _columns(schema):
    return list(schema.to_schema().columns)


# table -> (loader file name, columns the loader reads). datasets carries three
# columns DatasetSchema leaves out (its columns also drive the harvester's
# spill registration, so they are not added there).
LOADER_TABLES = {
    "datasets": ("datasets.csv", _columns(DatasetSchema) + ["title_fr", "ckan_id", "obis_nodes"]),
    "profiles": ("profiles.csv", _columns(ProfileSchema)),
    "skipped_datasets": ("skipped.csv", _columns(SkippedDatasetSchema)),
    "obis_cells": ("obis_cells.csv", _columns(ObisCellSchema)),
    "trajectory_days": ("trajectory_days.csv", _columns(TrajectoryDaySchema)),
    "trajectory_points": ("trajectory_points.csv", _columns(TrajectoryPointSchema)),
    "harvest_runs": ("harvest_runs.csv", _columns(HarvestRunSchema)),
    "harvest_attempts": ("harvest_attempts.csv", _columns(HarvestAttemptSchema)),
}
# The loader opens these whether or not they have rows.
ALWAYS_WRITTEN = {"datasets", "profiles", "skipped_datasets"}
# What a re-harvest fills in: a column missing from one of these is worth
# re-fetching for, while an audit or skip-list column never gets backfilled.
CONTENT_TABLES = ("datasets", "profiles", "obis_cells", "trajectory_days", "trajectory_points")
# A NULL here reaches ast.literal_eval as NaN, which raises, and only after the
# rebuild has already dropped the schema.
DATASET_ARRAY_COLUMNS = {"eovs", "organizations", "profile_variables", "obis_nodes"}
DATERANGE_COLUMNS = {"day_ranges"}

# The datasets/organizations lookups hold the pk_url in every shared
# datasetPKs= / organizations= link; a load without them renumbers each one.
# Vernaculars come from WoRMS, and the load reads them to resolve aphia ids.
AUX_TABLES = ("datasets_lookup", "organizations_lookup", "scientific_name_vernaculars")


def _present_columns(conn):
    rows = conn.execute(
        text("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'cde'")
    )
    present = {}
    for table, column in rows:
        present.setdefault(table, set()).add(column)
    return present


def _select_list(table, columns):
    def column(c):
        if table == "datasets" and c in DATASET_ARRAY_COLUMNS:
            return f"coalesce({c}, '{{}}') AS {c}"
        return c

    return ", ".join(column(c) for c in columns)


def export_snapshot(engine, out_dir):
    """Write the harvested and aux tables into ``out_dir``; return the manifest's per-table record.

    Every table is read in one REPEATABLE READ transaction, so a load that
    commits halfway through cannot leave profiles referring to datasets the
    snapshot does not have. Columns are the loader's contract intersected with
    what this database has, so an older schema exports what it can; a table it
    lacks is recorded as None.
    """
    out_dir = Path(out_dir)
    tables = {}
    with engine.connect().execution_options(
        isolation_level="REPEATABLE READ", postgresql_readonly=True
    ) as conn:
        present = _present_columns(conn)
        for table, (name, contract) in LOADER_TABLES.items():
            columns = [c for c in contract if c in present.get(table, ())]
            if not columns:
                tables[table] = None
                continue
            df = pd.read_sql(text(f"SELECT {_select_list(table, columns)} FROM cde.{table}"), conn)
            for c in DATERANGE_COLUMNS.intersection(columns):
                df[c] = df[c].map(lambda v: ranges_to_csv_cell(ranges_from_psycopg(v)))
            if len(df) or table in ALWAYS_WRITTEN:
                df.to_csv(out_dir / name, index=False)
            tables[table] = {"rows": len(df), "columns": columns}
            del df

        # The same DBAPI connection, so COPY reads the same snapshot.
        with conn.connection.cursor() as cur:
            for table in AUX_TABLES:
                if table not in present:
                    tables[table] = None
                    continue
                with open(out_dir / f"{table}.pg.csv", "w", newline="") as f:
                    cur.copy_expert(f"COPY (SELECT * FROM cde.{table}) TO STDOUT WITH CSV HEADER", f)
                tables[table] = {"columns": sorted(present[table])}
    return tables


def restore_aux_tables(engine, folder):
    """Restore the aux tables from a snapshot folder into a freshly rebuilt schema."""
    with engine.begin() as conn:
        types = dict(
            conn.execute(
                text("""
                    SELECT c.relname || '.' || a.attname, format_type(a.atttypid, a.atttypmod)
                    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'cde' AND a.attnum > 0 AND NOT a.attisdropped
                """)
            ).all()
        )
        for table in AUX_TABLES:
            path = Path(folder) / f"{table}.pg.csv"
            if not path.is_file():
                continue
            with open(path, newline="") as f:
                header = next(csv.reader(f))
            columns = [c for c in header if f"{table}.{c}" in types]
            conn.execute(text(
                f"CREATE TEMP TABLE _restore ({', '.join(f'{c} text' for c in header)}) ON COMMIT DROP"
            ))
            with conn.connection.cursor() as cur, open(path, newline="") as f:
                cur.copy_expert("COPY _restore FROM STDIN WITH CSV HEADER", f)
            # text has no assignment cast to int or arrays, so cast each column
            # to its target type explicitly.
            casts = ", ".join(f"{c}::{types[table + '.' + c]}" for c in columns)
            conn.execute(text(
                f"INSERT INTO cde.{table} ({', '.join(columns)}) SELECT {casts} FROM _restore "
                "ON CONFLICT DO NOTHING"
            ))
            conn.execute(text("DROP TABLE _restore"))
            if "pk" in columns:
                # Without this, nextval hands out a restored pk, ON CONFLICT DO
                # NOTHING skips the new row, and its pk_url stays NULL.
                conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('cde.{table}', 'pk'), "
                    f"coalesce(max(pk), 1), max(pk) IS NOT NULL) FROM cde.{table}"
                ))


def drop_stale_hashes(folder, manifest):
    """Clear content_hash when the snapshot lacks columns this code loads.

    An unchanged hash makes the next incremental harvest skip the dataset, so
    columns the old schema never had would stay empty until its source changed.
    """
    tables = (manifest or {}).get("tables") or {}
    missing = {
        table: sorted(set(LOADER_TABLES[table][1]) - set((tables.get(table) or {}).get("columns") or ()))
        for table in CONTENT_TABLES
        if table in tables
    }
    missing = {t: cols for t, cols in missing.items() if cols}
    datasets = Path(folder) / "datasets.csv"
    if missing and datasets.is_file():
        df = pd.read_csv(datasets)
        if "content_hash" in df.columns:
            df["content_hash"] = None
            df.to_csv(datasets, index=False)
    return missing


def _datasets_rows(manifest):
    return ((manifest.get("tables") or {}).get("datasets") or {}).get("rows") or 0


def check_restorable(manifest, url):
    """Raise unless ``manifest`` is a non-empty snapshot this code can load.

    Called before the rebuild drops anything. A run is a delta, and loading one as
    the whole database would drop every other source; a snapshot from newer code
    carries columns this schema lacks, which the load would only reject after the
    drop.
    """
    if not manifest or manifest.get("kind") != "snapshot":
        raise ValueError(f"{url} is not a published snapshot; nothing was touched")
    if not _datasets_rows(manifest):
        raise ValueError(f"{url} holds no datasets, so restoring it would empty the site; nothing was touched")
    unknown = {
        table: sorted(set(record["columns"]) - set(LOADER_TABLES[table][1]))
        for table, record in (manifest.get("tables") or {}).items()
        if table in LOADER_TABLES and record
    }
    unknown = {table: columns for table, columns in unknown.items() if columns}
    if unknown:
        raise ValueError(
            f"{url} has columns this version cannot load ({unknown}); restore it with "
            "the version that wrote it. Nothing was touched"
        )


def latest_published(base_url):
    """URL of the newest complete, non-empty snapshot under ``<base_url>/snapshots/``, or None.

    Listed rather than read from a pointer file: the gateway offers no
    compare-and-swap to keep a pointer consistent, and its listings are.
    """
    fs, root, call = publish._fs(base_url)
    try:
        entries = fs.ls(f"{root}/snapshots", detail=False, **call)
    except FileNotFoundError:
        return None
    for entry in sorted(entries, reverse=True):
        name = entry.rstrip("/").rsplit("/", 1)[-1]
        try:
            manifest = json.loads(fs.cat_file(f"{root}/snapshots/{name}/{publish.MANIFEST}", **call))
        except FileNotFoundError:
            continue  # an upload that never finished
        if _datasets_rows(manifest):
            return f"{base_url}/snapshots/{name}"
    return None


def take_snapshot(engine, url):
    """Export the database and publish it to ``url``; return the manifest."""
    with tempfile.TemporaryDirectory(prefix="cde_snapshot_") as tmp:
        tables = export_snapshot(engine, tmp)
        return publish.publish_folder(tmp, url, kind="snapshot", incremental=False, tables=tables)


@contextmanager
def loader_lock(engine):
    """Hold the loader's advisory lock, so no load writes between an export and its restore.

    A session lock on its own connection: the loader takes the same key as a
    transaction lock, so this must be released before the restore load runs.
    """
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": DB_LOADER_ADVISORY_LOCK_KEY})
        try:
            yield
        finally:
            # A connection that dropped has released its session lock with it.
            with suppress(Exception):
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": DB_LOADER_ADVISORY_LOCK_KEY})
