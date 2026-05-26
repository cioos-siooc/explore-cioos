"""SQLAlchemy engine reading the same Postgres the CIOOS web-api uses.

DATABASE_URL takes precedence; otherwise we build the URL from the same
DB_HOST_EXTERNAL / DB_NAME / DB_USER / DB_PASSWORD / DB_PORT env vars the
rest of the stack uses (see db-loader/cde_db_loader/__main__.py).
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine

load_dotenv()


def _build_url() -> str:
    if url := os.environ.get("DATABASE_URL"):
        return url
    host = os.environ.get("DB_HOST_EXTERNAL") or os.environ.get("DB_HOST") or "db"
    port = os.environ.get("DB_PORT", "5432")
    user = os.environ["DB_USER"]
    password = os.environ["DB_PASSWORD"]
    name = os.environ["DB_NAME"]
    return f"postgresql+psycopg://{user}:{password}@{host}:{port}/{name}"


engine = create_engine(_build_url(), pool_pre_ping=True, future=True)
