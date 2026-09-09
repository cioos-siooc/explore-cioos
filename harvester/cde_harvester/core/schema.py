"""Rebuild the CDE schema from the numbered files in ``database/``.

Why this exists
---------------
``database/1_schema.sql`` is the only place ``cde.profiles``, ``cde.trajectory_hexes``
and friends are ever created, and Postgres runs it exactly once — via
``/docker-entrypoint-initdb.d`` on a **fresh** data volume. ``db_migrate`` re-applies
only ``[3-9]_*.sql``, which are pure ``CREATE OR REPLACE FUNCTION``; every table
reference in them sits inside a PL/pgSQL body, which Postgres does not validate at
creation time.

So a deploy that changes the table layout (e.g. the 2026-08-20 replacement of
``trajectory_cells`` with ``trajectory_hexes`` + ``trajectory_days``) reports a clean,
successful migration while leaving the database on the old schema. The mismatch only
surfaces later, at the first query: ``relation "cde.trajectory_hexes" does not exist``.

Recovering from that used to mean deleting the Postgres volume (destroying the harvest
and needing host shell access) or hand-running psql inside the db container. This module
does the same thing from the harvester, so it can be driven as a Prefect deployment.

What it does NOT do
-------------------
Preserve data. ``DROP SCHEMA cde CASCADE`` is exactly as destructive as dropping the
volume; the point is only that it needs no volume surgery and no host shell. Callers are
responsible for confirming intent and for re-harvesting afterwards.

Why not just re-run 1_schema.sql
--------------------------------
It is not idempotent against a populated database. ``CREATE schema cde`` has no
``IF NOT EXISTS``, the 18 ``DROP TABLE`` statements carry no ``CASCADE`` (so the 10
foreign keys block them in file order), and the two materialized views have no preceding
drop. Re-running it half-applies and leaves the schema wrecked. Dropping the schema
first sidesteps all of that ordering.
"""

import os
import re
from pathlib import Path

from sqlalchemy import text

# Applied by the db container's entrypoint on a fresh volume; holds every CREATE TABLE.
INIT_SQL_NAME = "1_schema.sql"
# The function/procedure files db_migrate re-applies on every deploy. DROP SCHEMA
# CASCADE takes the functions with it, so a rebuild has to re-apply these too.
FUNCTION_SQL_GLOB = "[3-9]_*.sql"

SCHEMA_NAME = "cde"

# Don't wait indefinitely for ACCESS EXCLUSIVE. Idle pooled connections (web-api) don't
# hold table locks, but an in-flight query or a stray open transaction does, and a
# rebuild that blocks forever is worse than one that fails with a clear message.
DEFAULT_LOCK_TIMEOUT = "30s"


def database_dir(explicit=None):
    """Directory holding the numbered SQL files.

    ``CDE_DATABASE_DIR`` wins, then the image path baked by harvester/Dockerfile, then
    the repo checkout (so this is runnable from a dev tree without env setup).
    """
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
    """Raise unless ``confirm`` names the database being rebuilt.

    The rebuild is exposed as a Prefect deployment, which means a Run button in the UI
    sits one click away from destroying a harvest. Requiring the database name to be
    typed makes that click deliberate, and makes it hard to wipe the wrong environment
    by re-running a flow that was parameterised for another one.
    """
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
            # The common case, and it is NOT a misconfiguration: `confirm` defaults to
            # empty so a one-click Run in the Prefect UI cannot wipe a database. Say so,
            # because an operator who just fixed a real env problem reads any red run as
            # "still broken" and goes looking for another bug.
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
    """Sort key so 9_* follows 5_* rather than sorting lexically."""
    match = re.match(r"(\d+)", path.name)
    return (int(match.group(1)) if match else 0, path.name)


def schema_files(directory=None):
    """``(init_file, [function_files...])`` in the order they must be applied.

    Raises FileNotFoundError when the init file is missing — that means the SQL was
    never copied into the image, and going ahead would drop the schema with no way to
    recreate it.
    """
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
    """``CREATE DATABASE name`` if it is absent. Returns True when it had to be created.

    A deployment whose Postgres volume initialised BEFORE DB_NAME was set has no `cde`
    database at all: the db service passes ``POSTGRES_DB=$DB_NAME``, so an empty value
    leaves the image creating only the default ``postgres`` database. Everything then
    fails with ``FATAL: database "cde" does not exist`` — and the rebuild cannot dig
    itself out, because ``1_schema.sql`` assumes it is already connected to the target
    and ``CREATE DATABASE`` cannot run inside a transaction.

    Runs against the maintenance database (``postgres``), which always exists. Mirrors
    the ``prefect`` service's own ensure_db bootstrap, except that one connects to
    DB_NAME and so cannot help when DB_NAME is what is missing.
    """
    if '"' in name:
        # Identifier interpolation below cannot be parameterised; refuse anything that
        # could break out of the quoting rather than escaping it cleverly.
        raise ValueError(f"Refusing to create a database with a quote in its name: {name!r}")
    with maint_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
        ).scalar()
        if exists:
            return False
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    return True


# The search_path Postgres gives a fresh session. The db image's entrypoint runs each
# .sql file in its OWN psql invocation, so a `SET search_path` inside one file never
# reaches the next; restoring this before every file reproduces that isolation.
DEFAULT_SEARCH_PATH = '"$user", public'


def _apply_sql_file(conn, path):
    """Execute one whole .sql file in the current transaction, at the default search_path.

    The search_path reset is essential, not cosmetic. ``1_schema.sql`` ends with
    ``SET search_path TO cde, public``. On a fresh volume that is harmless because the
    entrypoint runs every file as a separate psql process, so ``3_*``..``9_*`` create their
    functions at the DEFAULT search_path and they land in ``public`` — which is where the
    app looks for them (``SELECT create_temp_tables()`` etc.). Applying all the files in one
    connection, as this module does, would otherwise let that SET persist and create every
    function in ``cde``, where the db-loader cannot see it:
    ``function create_temp_tables() does not exist``.

    Goes down to the raw DBAPI cursor rather than ``text()`` or ``exec_driver_sql``.
    These files are full of dollar-quoted PL/pgSQL bodies, ``::`` casts and ``%`` in
    format strings: ``text()`` would try to parse ``:name`` bindparams out of them, and
    ``exec_driver_sql`` hands psycopg2 an empty params mapping, which makes it attempt
    ``%`` interpolation and fail with "immutabledict is not a sequence". psycopg2 does no
    interpolation at all when ``execute`` is given no parameters, and happily runs
    multiple semicolon-separated statements in one call.
    """
    cursor = conn.connection.cursor()
    try:
        cursor.execute(f"SET search_path TO {DEFAULT_SEARCH_PATH}")
        cursor.execute(path.read_text())
    finally:
        cursor.close()


def rebuild_schema(engine, directory=None, lock_timeout=DEFAULT_LOCK_TIMEOUT):
    """Drop and recreate the ``cde`` schema. DESTROYS ALL DATA.

    Everything runs in ONE transaction: a failure part-way (a lock timeout, a syntax
    error in a hand-edited file) rolls back to the pre-rebuild schema rather than
    leaving the half-dropped mess a bare psql run would.

    Returns a report dict for the caller to log.
    """
    init, functions = schema_files(directory)

    with engine.begin() as conn:
        conn.execute(text(f"SET lock_timeout = '{lock_timeout}'"))
        # IF EXISTS so this also works as a first-time bootstrap against an empty DB.
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
