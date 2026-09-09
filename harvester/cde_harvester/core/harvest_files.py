"""The harvest folder: which tables it holds, and how a frame gets in and out.

Both sides of the handoff used to declare the same nine filenames independently
and agree on a *text* contract for anything that is not a scalar: list columns
went out through ``repr()`` and came back through ``ast.literal_eval`` at eight
separate sites. The parsing was the cheap part. The contract also meant:

* lists are unhashable, so the profiles frame had to be repr'd *before*
  ``drop_duplicates()`` could see those columns at all;
* ``repr(datetime.date(2020, 1, 1))`` is a constructor call, which
  ``literal_eval`` refuses, so day sets needed their own ISO detour;
* an absent cell arrives from a CSV as NaN — neither a list nor a string — so
  every read site carried its own ``isinstance`` guard against it.

Parquet carries the types, so none of that is needed. duckdb is already a
harvester dependency and brings its own parquet reader and writer, so this
costs no new package — pandas' own ``read_parquet`` would have pulled in
pyarrow.

Two details of duckdb's pandas conversion are load-bearing and are handled in
:func:`read_table`, not left to callers:

* LIST columns come back as numpy arrays (nested arrays for nested lists), and
  psycopg2 cannot adapt one at all — ``can't adapt type 'numpy.ndarray'`` — so
  the loader would fail on every array column. They are converted back to
  plain lists here.
* A tz-aware timestamp is rendered in the DuckDB session's timezone, which
  defaults to the machine's. Every timestamp in this pipeline is UTC, and a day
  boundary read in local time shifts dates silently, so the connection pins UTC
  rather than trusting the host.
"""

import os

import duckdb
import numpy as np
import pandas as pd

# One row per table the harvester writes and the loader reads. Both sides
# import these rather than spelling out paths, which is what kept the file set
# in step across two modules that each used to declare all nine.
DATASETS = "datasets"
PROFILES = "profiles"
SKIPPED = "skipped"
CKAN = "ckan"
OBIS_CELLS = "obis_cells"
TRAJECTORY_DAYS = "trajectory_days"
TRAJECTORY_POINTS = "trajectory_points"
VERIFIED = "verified"
HARVEST_RUNS = "harvest_runs"
HARVEST_ATTEMPTS = "harvest_attempts"

SUFFIX = ".parquet"
# What the folder held before parquet. Only used to tell an operator pointing
# the loader at a stale folder what actually happened.
LEGACY_SUFFIX = ".csv"


def table_path(folder, name):
    """Path of one table in a harvest folder."""
    return os.path.join(folder, name + SUFFIX)


def _connection():
    """A DuckDB connection with the timezone pinned. See the module docstring.

    Fresh per call rather than shared at module level: harvest tasks run
    concurrently under Prefect, and an in-memory connect is microseconds.
    """
    connection = duckdb.connect()
    connection.execute("SET TimeZone='UTC'")
    return connection


def write_table(folder, name, df):
    """Write one table into the harvest folder. Returns the path written."""
    os.makedirs(folder, exist_ok=True)
    path = table_path(folder, name)
    _connection().from_df(df).write_parquet(path)
    return path


def _to_python(value):
    """One cell of an object column, as plain Python.

    Arrays become lists (recursively — day_ranges is a list of pairs, so it
    arrives two levels deep), numpy scalars become their Python equivalents,
    and pandas' NA becomes None. Everything else, including a string that
    merely happens to live in an object column, is returned untouched.

    The scalar case is not cosmetic. An integer list column (organization_pks,
    aphia_ids) comes back as an array of numpy.int32, and psycopg2 adapts a
    numpy scalar no better than it adapts an array: unwrapping only the array
    leaves `can't adapt type 'numpy.int32'` waiting at the INSERT.
    """
    if isinstance(value, np.ndarray):
        return [_to_python(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    return None if value is pd.NA else value


def read_table(folder, name):
    """Read one table from a harvest folder, or None when it is not there.

    Most tables are optional: a folder from an ERDDAP-only harvest has no
    obis_cells, and one from before a feature landed has none of its columns.
    Callers decide what a missing table means.
    """
    path = table_path(folder, name)
    if not os.path.isfile(path):
        legacy = os.path.join(folder, name + LEGACY_SUFFIX)
        if os.path.isfile(legacy):
            raise FileNotFoundError(
                f"{path} not found, but {legacy} exists. This harvest folder was "
                "written by a harvester that used the CSV format; the two are not "
                "interchangeable, because the CSV carried list columns as Python "
                "reprs. Re-harvest into a fresh folder."
            )
        return None
    df = _connection().read_parquet(path).df()
    for column in df.columns:
        if df[column].dtype == object:
            df[column] = df[column].map(_to_python)
    return df


def _hashable(value):
    """A cell rendered comparable for de-duplication, lists included."""
    if isinstance(value, (list, np.ndarray)):
        return tuple(_hashable(item) for item in value)
    return value


def drop_duplicate_rows(df):
    """Full-row ``drop_duplicates()`` for a frame carrying list columns.

    pandas hashes each row and a list is unhashable, so this raises TypeError
    on a frame holding eovs or day_ranges. Comparing a tuple copy is exactly
    the comparison the previous repr()-then-dedup performed, without needing
    the frame to be serialized first.
    """
    hashable = df.copy()
    for column in hashable.columns:
        if hashable[column].dtype == object:
            hashable[column] = hashable[column].map(_hashable)
    return df[~hashable.duplicated()]
