"""Read-only lookup of the CKAN metadata stored by previous harvests (fail-open)."""

import logging

import pandas as pd
from sqlalchemy import bindparam, text

from cde_harvester.core.db import create_db_engine
from cde_harvester.core.observability import run_logger

_module_logger = logging.getLogger(__name__)

PREVIOUS_CKAN_COLUMNS = [
    "erddap_url", "dataset_id", "ckan_id", "title", "title_fr", "organizations", "eovs",
]


def load_previous_ckan(erddap_urls):
    """CKAN-linked rows of cde.datasets for these sources; empty on any error."""
    logger = run_logger(_module_logger)
    urls = sorted({u.rstrip("/") for u in erddap_urls})
    try:
        engine = create_db_engine()
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"SELECT {', '.join(PREVIOUS_CKAN_COLUMNS)} FROM cde.datasets "
                    "WHERE erddap_url IN :urls AND ckan_id IS NOT NULL"
                ).bindparams(bindparam("urls", expanding=True)),
                {"urls": urls},
            ).all()
        logger.info("Loaded %d previous CKAN links for %d sources", len(rows), len(urls))
        return pd.DataFrame(rows, columns=PREVIOUS_CKAN_COLUMNS)
    except Exception as e:
        logger.warning("Could not load previous CKAN metadata: %s", e)
        return pd.DataFrame(columns=PREVIOUS_CKAN_COLUMNS)
