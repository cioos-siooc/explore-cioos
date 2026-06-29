"""Read-only lookup of previously-harvested dataset content hashes (fail-open)."""

import logging
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

try:
    from prefect import get_run_logger
except Exception:
    get_run_logger = None

_module_logger = logging.getLogger(__name__)


def _logger():
    if get_run_logger is not None:
        try:
            return get_run_logger()
        except Exception:
            pass
    return _module_logger


def _database_link():
    load_dotenv(os.getcwd() + "/.env")
    envs = os.environ
    db_host = envs.get("DB_HOST_EXTERNAL", "localhost")
    return (
        f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}"
        f"@{db_host}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
    )


def load_previous_hashes(erddap_url):
    """{dataset_id: content_hash} for a server; {} on any error (harvest all)."""
    logger = _logger()
    try:
        engine = create_engine(_database_link())
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT dataset_id, content_hash FROM cde.datasets "
                    "WHERE erddap_url = :url AND content_hash IS NOT NULL"
                ),
                {"url": erddap_url.rstrip("/")},
            ).all()
        hashes = {dataset_id: content_hash for dataset_id, content_hash in rows}
        logger.info("Loaded %d previous content hashes for %s", len(hashes), erddap_url)
        return hashes
    except Exception as e:
        logger.warning(
            "Could not load previous content hashes for %s (harvesting all): %s",
            erddap_url, e,
        )
        return {}
