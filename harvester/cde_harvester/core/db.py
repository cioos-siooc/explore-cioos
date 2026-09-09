"""Shared PostgreSQL connection handling.

Single home for the CDE connection-string logic that was previously duplicated
across the harvester's dataset-state lookup, the db-loader and
populate_vernaculars. Reads the same env vars as before (optionally from a
``.env`` in the current working directory): DB_HOST_EXTERNAL, DB_PORT, DB_NAME,
DB_USER, DB_PASSWORD.
"""

import os
import sys

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def _load_env():
    """Load the nearest ``.env`` (cwd, then ancestors) into os.environ.

    Kept in one place because reading ``os.environ`` *without* it sees a different — and
    usually smaller — set of variables than the engine will connect with. A Prefect flow
    run is the case that bites: the deployment's ``set_working_directory`` pull step puts
    the run in the harvester dir, and on some deployments the DB settings arrive from a
    ``.env`` rather than from the container environment. Any code deciding something about
    the database (not just connecting to it) has to resolve names the same way, or it will
    disagree with the connection it is about to open — which is how a rebuild guard came
    to report DB_NAME unset on a worker whose harvests were connecting fine.

    Searches ancestors (``find_dotenv``) rather than only ``$CWD/.env``, because the file
    is as likely to sit at the repo/app root as in the harvester dir. Nearest wins, and
    it never overrides variables already in the environment.
    """
    path = find_dotenv(usecwd=True)
    if path:
        load_dotenv(path)


# Settings with no sensible default: the connection cannot be built without them.
# DB_HOST_EXTERNAL and DB_PORT are omitted deliberately — both have working defaults.
REQUIRED_DB_SETTINGS = ("DB_NAME", "DB_USER", "DB_PASSWORD")


def missing_db_settings():
    """Which of REQUIRED_DB_SETTINGS are absent, resolved as database_url() resolves them.

    Coolify supplies none of these automatically (see .env.coolify.sample), so a fresh
    deployment can register its deployments happily and then fail inside every flow run.
    Callers use this to report the misconfiguration up front instead.
    """
    _load_env()
    return [name for name in REQUIRED_DB_SETTINGS if not os.environ.get(name)]


def database_url():
    _load_env()
    missing = [name for name in REQUIRED_DB_SETTINGS if not os.environ.get(name)]
    if missing:
        # Previously a bare KeyError from the f-string, which named only the first
        # missing variable and gave no hint that this is deployment config.
        raise ValueError(
            f"Cannot build a database connection: {', '.join(missing)} not set. "
            "These come from the deployment environment (Coolify environment variables, "
            "or a .env file); see .env.coolify.sample. "
            f"Searched from cwd={os.getcwd()!r}."
        )
    envs = os.environ
    db_host = envs.get("DB_HOST_EXTERNAL", "localhost")
    return (
        f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}"
        f"@{db_host}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
    )


def db_host():
    """The host part of the connection, for log messages."""
    _load_env()
    return os.environ.get("DB_HOST_EXTERNAL", "localhost")


def db_name():
    """The database name, resolved exactly as database_url() resolves it.

    Empty string when unset, so callers can report the misconfiguration themselves
    instead of dying on a KeyError deep inside connection setup.
    """
    _load_env()
    return os.environ.get("DB_NAME", "")


def create_db_engine(**kwargs):
    """SQLAlchemy engine for the CDE database. kwargs pass through to create_engine."""
    return create_engine(database_url(), **kwargs)


# Always present on a Postgres cluster, so it is where you connect to ask questions
# about — or create — other databases.
MAINTENANCE_DATABASE = "postgres"


def maintenance_engine(**kwargs):
    """Engine bound to the ``postgres`` database, for CREATE DATABASE and the like.

    AUTOCOMMIT because CREATE DATABASE cannot run inside a transaction block.
    """
    url = make_url(database_url()).set(database=MAINTENANCE_DATABASE)
    kwargs.setdefault("isolation_level", "AUTOCOMMIT")
    return create_engine(url, **kwargs)


def database_is_empty():
    """True when the CDE database holds no harvested datasets yet.

    Treats a missing ``cde.datasets`` table (a brand-new database that has never
    been harvested) as empty. Used by the worker entrypoint to decide whether a
    RUN_ON_DEPLOY harvest should fire on a fresh install.
    """
    engine = create_db_engine()
    try:
        with engine.connect() as conn:
            if conn.execute(text("SELECT to_regclass('cde.datasets')")).scalar() is None:
                return True
            return conn.execute(text("SELECT NOT EXISTS (SELECT 1 FROM cde.datasets)")).scalar()
    finally:
        engine.dispose()


if __name__ == "__main__":
    # --print-missing: comma-separated list of absent required settings (empty when the
    # environment is complete). Always exits 0 so a shell can test the output, not the
    # status — used by worker-entrypoint.sh's pre-flight.
    if "--print-missing" in sys.argv:
        print(",".join(missing_db_settings()))
        sys.exit(0)
    # Exit 0 when empty, 1 when the database already holds datasets, so a shell
    # `if` can gate the RUN_ON_DEPLOY harvest on a fresh install.
    sys.exit(0 if database_is_empty() else 1)
