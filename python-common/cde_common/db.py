"""The CDE PostgreSQL connection, resolved the same way by every service.

Single home for the connection-string logic. It used to sit under the harvester
while the download scheduler — which imported that very module — built its own
URL from a *different* environment variable, so one process had two answers for
"which host is the database on".

Settings (optionally from a ``.env``, see :mod:`cde_common.env`): DB_NAME,
DB_USER, DB_PASSWORD, DB_HOST_EXTERNAL or DB_HOST, DB_PORT.
"""

import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from cde_common.env import load_env

# Settings with no sensible default: the connection cannot be built without them.
# The host and port are omitted deliberately — both have working defaults.
REQUIRED_DB_SETTINGS = ("DB_NAME", "DB_USER", "DB_PASSWORD")

# Both names, in order, because the compose files use them for different
# audiences: DB_HOST=db addresses Postgres from inside the container network,
# DB_HOST_EXTERNAL is the address a harvester or worker uses to reach it from
# outside (over the VPN, in production). A service that reads only one of them
# silently falls back to "localhost" when the deployment set the other — and
# every .env.sample in the tree ships DB_HOST, so that was the common case.
DB_HOST_SETTINGS = ("DB_HOST_EXTERNAL", "DB_HOST")

DEFAULT_DB_HOST = "localhost"
DEFAULT_DB_PORT = 5432


def missing_db_settings():
    """Which of REQUIRED_DB_SETTINGS are absent, resolved as database_url() resolves them.

    Coolify supplies none of these automatically (see .env.coolify.sample), so a
    fresh deployment can register its deployments happily and then fail inside
    every flow run. Callers use this to report the misconfiguration up front.
    """
    load_env()
    return [name for name in REQUIRED_DB_SETTINGS if not os.environ.get(name)]


def db_host():
    """The host the connection will use — also what log and error messages report."""
    load_env()
    for name in DB_HOST_SETTINGS:
        value = os.environ.get(name)
        if value:
            return value
    return DEFAULT_DB_HOST


def db_name():
    """The database name, resolved exactly as database_url() resolves it.

    Empty string when unset, so callers can report the misconfiguration
    themselves instead of dying on a KeyError deep inside connection setup.
    """
    load_env()
    return os.environ.get("DB_NAME", "")


def database_url():
    missing = missing_db_settings()
    if missing:
        # Previously a bare KeyError from the f-string, which named only the
        # first missing variable and gave no hint that this is deployment config.
        raise ValueError(
            f"Cannot build a database connection: {', '.join(missing)} not set. "
            "These come from the deployment environment (Coolify environment variables, "
            "or a .env file); see .env.coolify.sample. "
            f"Searched from cwd={os.getcwd()!r}."
        )
    envs = os.environ
    return (
        f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}"
        f"@{db_host()}:{envs.get('DB_PORT', DEFAULT_DB_PORT)}/{envs['DB_NAME']}"
    )


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
