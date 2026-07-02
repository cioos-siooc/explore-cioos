"""Read-only lookup of previously-harvested dataset content hashes (fail-open)."""

import logging

from sqlalchemy import text

from cde_harvester.core.db import create_db_engine
from cde_harvester.core.observability import run_logger

_module_logger = logging.getLogger(__name__)


def load_previous_hashes(erddap_url):
    """{dataset_id: content_hash} for a server; {} on any error (harvest all)."""
    logger = run_logger(_module_logger)
    try:
        engine = create_db_engine()
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
