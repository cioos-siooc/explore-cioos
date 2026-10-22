"""Shared PostgreSQL connection handling: DB_HOST_EXTERNAL, DB_PORT, DB_NAME,
DB_USER, DB_PASSWORD, optionally from the nearest ``.env``."""

import os
import sys

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def _load_env():
    """Any code deciding something about the database must call this first, or it
    sees different variables than the connection does (on some Prefect deployments
    DB settings come only from a ``.env``). Never overrides the environment."""
    path = find_dotenv(usecwd=True)
    if path:
        load_dotenv(path)


# DB_HOST_EXTERNAL and DB_PORT have working defaults.
REQUIRED_DB_SETTINGS = ("DB_NAME", "DB_USER", "DB_PASSWORD")


def missing_db_settings():
    """Coolify supplies none of these, so a fresh deployment would otherwise only
    fail inside every flow run."""
    _load_env()
    return [name for name in REQUIRED_DB_SETTINGS if not os.environ.get(name)]


def database_url():
    _load_env()
    missing = [name for name in REQUIRED_DB_SETTINGS if not os.environ.get(name)]
    if missing:
        raise ValueError(
            f"Cannot build a database connection: {', '.join(missing)} not set. "
            "These come from the deployment environment (Coolify environment variables, "
            "or a .env file); see .env.coolify.sample. "
            f"Searched from cwd={os.getcwd()!r}."
        )
    envs = os.environ
    db_host = envs.get("DB_HOST_EXTERNAL", "localhost")
    return (
        f"postgresql+psycopg2://{envs['DB_USER']}:{envs['DB_PASSWORD']}"
        f"@{db_host}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
    )


def db_host():
    _load_env()
    return os.environ.get("DB_HOST_EXTERNAL", "localhost")


def db_name():
    """Empty string when unset, so callers can report it themselves."""
    _load_env()
    return os.environ.get("DB_NAME", "")


def create_db_engine(**kwargs):
    return create_engine(database_url(), **kwargs)


MAINTENANCE_DATABASE = "postgres"


def maintenance_engine(**kwargs):
    """AUTOCOMMIT: CREATE DATABASE cannot run inside a transaction block."""
    url = make_url(database_url()).set(database=MAINTENANCE_DATABASE)
    kwargs.setdefault("isolation_level", "AUTOCOMMIT")
    return create_engine(url, **kwargs)


def database_is_empty():
    """A missing ``cde.datasets`` table counts as empty."""
    engine = create_db_engine()
    try:
        with engine.connect() as conn:
            if conn.execute(text("SELECT to_regclass('cde.datasets')")).scalar() is None:
                return True
            return conn.execute(text("SELECT NOT EXISTS (SELECT 1 FROM cde.datasets)")).scalar()
    finally:
        engine.dispose()


if __name__ == "__main__":
    # --print-missing always exits 0: worker-entrypoint.sh tests the output.
    if "--print-missing" in sys.argv:
        print(",".join(missing_db_settings()))
        sys.exit(0)
    # Exit 0 when empty, so a shell `if` can gate the RUN_ON_DEPLOY harvest.
    sys.exit(0 if database_is_empty() else 1)
