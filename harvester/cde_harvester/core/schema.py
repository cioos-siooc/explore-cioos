"""Rebuild the CDE schema from the numbered files in ``database/``. DESTROYS ALL DATA.

Postgres runs ``1_schema.sql`` only on a fresh volume and ``db_migrate`` re-applies
only the ``[3-9]_*.sql`` functions (whose table references Postgres doesn't validate),
so a table-layout change migrates "cleanly" and then fails at the first query.

Re-running 1_schema.sql alone isn't idempotent (no IF NOT EXISTS / CASCADE), hence
dropping the schema first.
"""

import os
import re
from pathlib import Path

from sqlalchemy import text

INIT_SQL_NAME = "1_schema.sql"
# DROP SCHEMA CASCADE takes the functions with it.
FUNCTION_SQL_GLOB = "[3-9]_*.sql"

SCHEMA_NAME = "cde"

# An in-flight query or stray open transaction would otherwise block forever.
DEFAULT_LOCK_TIMEOUT = "30s"


def database_dir(explicit=None):
    if explicit:
        return Path(explicit)
    env_dir = os.getenv("CDE_DATABASE_DIR")
    if env_dir:
        return Path(env_dir)
    baked = Path("/app/database")
    if baked.is_dir():
        return baked
    # harvester/cde_harvester/core/schema.py -> repo root
    return Path(__file__).resolve().parents[3] / "database"


def check_confirmation(confirm, db_name=None, host=None):
    """Raise unless ``confirm`` names the database being rebuilt, so a one-click
    Prefect Run can't wipe it (or the wrong environment)."""
    expected = db_name if db_name is not None else os.environ.get("DB_NAME", "")
    if not expected:
        from dotenv import find_dotenv

        dotenv_path = find_dotenv(usecwd=True) or "none found"
        raise ValueError(
            "DB_NAME is not set, so there is no database name to confirm against and no "
            "safe way to identify what would be dropped. This resolves DB_NAME exactly as "
            "the connection does: the process environment, plus the nearest .env. "
            f"Searched from cwd={os.getcwd()!r}, .env={dotenv_path!r}. "
            "If harvests connect fine but this is empty, they are getting DB_NAME from "
            "somewhere this does not look. Check the worker with: "
            "printenv | grep '^DB_'"
        )
    if confirm != expected:
        where = f" on {host}" if host else ""
        if not confirm:
            # Say it's expected: operators read any red run as "still broken".
            raise ValueError(
                f"No confirmation given, so nothing was touched. This flow DESTROYS ALL "
                f"DATA in the '{expected}' database{where}, so it requires the database "
                f"name as the 'confirm' parameter. This is expected, not a bug: 'confirm' "
                f"defaults to empty so a one-click run cannot wipe a database. "
                f"In the Prefect UI use 'Custom run' (NOT 'Quick run') and set "
                f"confirm={expected} ; from the CLI add -p confirm={expected}"
            )
        raise ValueError(
            f"Refusing to rebuild: confirm={confirm!r} does not match the database name. "
            f"This DESTROYS ALL DATA in the '{expected}' database"
            f"{where}. Re-run with confirm='{expected}' if that is what you want."
        )
    return expected


def _numeric_prefix(path):
    match = re.match(r"(\d+)", path.name)
    return (int(match.group(1)) if match else 0, path.name)


def schema_files(directory=None):
    """``(init_file, [function_files...])`` in application order. Raises when the
    init file is missing rather than drop a schema it can't recreate."""
    directory = Path(directory) if directory else database_dir()
    init = directory / INIT_SQL_NAME
    if not init.is_file():
        raise FileNotFoundError(
            f"{init} not found. The rebuild needs the numbered SQL files from the repo's "
            f"database/ directory; harvester/Dockerfile copies them to /app/database, and "
            f"CDE_DATABASE_DIR overrides the location."
        )
    functions = sorted(directory.glob(FUNCTION_SQL_GLOB), key=_numeric_prefix)
    return init, functions


def ensure_database(maint_engine, name):
    """``CREATE DATABASE name`` if absent; True when created.

    A volume initialised before DB_NAME was set (empty ``POSTGRES_DB``) has only the
    ``postgres`` database. ``maint_engine`` connects to ``postgres``.
    """
    if '"' in name:
        # Identifiers can't be parameterised; refuse rather than escape.
        raise ValueError(f"Refusing to create a database with a quote in its name: {name!r}")
    with maint_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
        ).scalar()
        if exists:
            return False
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    return True


# The db entrypoint runs each .sql file in its own psql session; restoring this
# before every file reproduces that isolation.
DEFAULT_SEARCH_PATH = '"$user", public'


def _apply_sql_file(conn, path):
    """Execute one whole .sql file at the default search_path.

    The reset is essential: ``1_schema.sql`` ends with ``SET search_path TO cde, public``,
    which would otherwise create every later function in ``cde`` instead of ``public``,
    where the app calls them.

    Raw DBAPI cursor: ``text()`` would parse ``:name`` bindparams out of ``::`` casts,
    and ``exec_driver_sql`` makes psycopg2 attempt ``%`` interpolation.
    """
    cursor = conn.connection.cursor()
    try:
        cursor.execute(f"SET search_path TO {DEFAULT_SEARCH_PATH}")
        cursor.execute(path.read_text())
    finally:
        cursor.close()


def rebuild_schema(engine, directory=None, lock_timeout=DEFAULT_LOCK_TIMEOUT):
    """Drop and recreate the ``cde`` schema in ONE transaction, so a failure
    part-way rolls back. DESTROYS ALL DATA."""
    init, functions = schema_files(directory)

    with engine.begin() as conn:
        conn.execute(text(f"SET lock_timeout = '{lock_timeout}'"))
        conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA_NAME} CASCADE"))
        _apply_sql_file(conn, init)
        for path in functions:
            _apply_sql_file(conn, path)

        tables = conn.execute(
            text(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = :schema"
            ),
            {"schema": SCHEMA_NAME},
        ).scalar()

    return {
        "schema": SCHEMA_NAME,
        "init_file": init.name,
        "function_files": [p.name for p in functions],
        "tables_created": tables,
    }
