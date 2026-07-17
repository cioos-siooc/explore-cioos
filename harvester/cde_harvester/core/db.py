"""Shared PostgreSQL connection handling.

Single home for the CDE connection-string logic that was previously duplicated
across the harvester's dataset-state lookup, the db-loader and
populate_vernaculars. Reads the same env vars as before (optionally from a
``.env`` in the current working directory): DB_HOST_EXTERNAL, DB_PORT, DB_NAME,
DB_USER, DB_PASSWORD.
"""

import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text


def database_url():
    load_dotenv(os.path.join(os.getcwd(), ".env"))
    envs = os.environ
    db_host = envs.get("DB_HOST_EXTERNAL", "localhost")
    return (
        f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}"
        f"@{db_host}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
    )


def db_host():
    """The host part of the connection, for log messages."""
    return os.environ.get("DB_HOST_EXTERNAL", "localhost")


def create_db_engine(**kwargs):
    """SQLAlchemy engine for the CDE database. kwargs pass through to create_engine."""
    return create_engine(database_url(), **kwargs)


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
    # Exit 0 when empty, 1 when the database already holds datasets, so a shell
    # `if` can gate the RUN_ON_DEPLOY harvest on a fresh install.
    sys.exit(0 if database_is_empty() else 1)
