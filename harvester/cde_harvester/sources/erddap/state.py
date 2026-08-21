"""Read-only lookup of previously-harvested dataset state (fail-open)."""

import logging

from sqlalchemy import text

from cde_harvester.core.db import create_db_engine
from cde_harvester.core.observability import run_logger

_module_logger = logging.getLogger(__name__)


def load_previous_state(erddap_url):
    """{dataset_id: {content_hash, source_extent_hash, last_updated_at}} for a server.

    One query, fail-open: any error returns {}, which makes every dataset look
    new and the whole server gets harvested. Rows with no stored signal at all
    are omitted, so a missing key and an unusable key read the same to callers.
    """
    logger = run_logger(_module_logger)
    try:
        engine = create_db_engine()
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT dataset_id, content_hash, source_extent_hash, last_updated_at "
                    "FROM cde.datasets "
                    "WHERE erddap_url = :url "
                    "AND (content_hash IS NOT NULL OR source_extent_hash IS NOT NULL)"
                ),
                {"url": erddap_url.rstrip("/")},
            ).all()
        state = {
            dataset_id: {
                "content_hash": content_hash,
                "source_extent_hash": source_extent_hash,
                "last_updated_at": last_updated_at,
            }
            for dataset_id, content_hash, source_extent_hash, last_updated_at in rows
        }
        logger.info("Loaded previous state for %d datasets on %s", len(state), erddap_url)
        return state
    except Exception as e:
        logger.warning(
            "Could not load previous dataset state for %s (harvesting all): %s",
            erddap_url, e,
        )
        return {}
