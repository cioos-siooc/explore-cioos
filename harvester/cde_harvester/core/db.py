"""Shared PostgreSQL connection handling.

Single home for the CDE connection-string logic that was previously duplicated
across the harvester's dataset-state lookup, the db-loader and
populate_vernaculars. Reads the same env vars as before (optionally from a
``.env`` in the current working directory): DB_HOST_EXTERNAL, DB_PORT, DB_NAME,
DB_USER, DB_PASSWORD.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine


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
