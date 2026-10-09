"""Match OBIS datasets to the national CKAN records that cite them.

Uses the same catalogue and paged package_search as the ERDDAP link, so a
stored ckan_id resolves to the same catalogue record URL. A record cites an
OBIS dataset by its obis.org/dataset/<uuid> page or by the IPT resource page
that the OBIS dataset metadata gives as ``url``.
"""

import logging
import re
from urllib.parse import parse_qs, urlparse

import pandas as pd
import requests

from cde_harvester.core.observability import run_logger
from cde_harvester.sources.ckan.create_ckan_erddap_link import (
    list_ckan_records,
    remove_newlines,
    unescape_ascii,
)
from cde_harvester.sources.ckan.state import load_previous_ckan

logger = logging.getLogger(__name__)

OBIS_RECORDS_QUERY = "res_url:*obis.org* OR res_url:*ipt*"
CKAN_OBIS_COLUMNS = ["dataset_id", "ckan_id", "ckan_eovs", "ckan_title", "title_fr"]

_OBIS_DATASET_URL = re.compile(r"obis\.org/dataset/([0-9a-f-]{36})")


def ipt_resource_key(url):
    """Scheme/case/endpoint/version-insensitive key for an IPT resource link.

    Keeps the IPT's context path: one host (ipt.iobis.org) runs several IPTs
    whose resource short names can collide.
    """
    parsed = urlparse(url.strip().lower())
    shortname = parse_qs(parsed.query).get("r")
    if not shortname:
        return None
    context = parsed.path.rsplit("/", 1)[0]
    return f"{parsed.netloc}{context}?r={shortname[0]}"


def _ckan_row(dataset_id, record):
    title_translated = record.get("title_translated") or {}
    title, title_fr = (
        remove_newlines(unescape_ascii(v)) if v else v
        for v in (title_translated.get("en"), title_translated.get("fr"))
    )
    return {
        "dataset_id": dataset_id,
        "ckan_id": record["id"],
        "ckan_eovs": record.get("eov") or [],
        "ckan_title": title,
        "title_fr": title_fr,
    }


def _stored_ckan_rows(dataset_ids, erddap_url):
    previous = load_previous_ckan([erddap_url])
    previous = previous[previous["dataset_id"].isin(dataset_ids)]
    return [
        {
            "dataset_id": row.dataset_id,
            "ckan_id": row.ckan_id,
            "ckan_eovs": list(row.eovs or []),
            "ckan_title": row.title,
            "title_fr": row.title_fr,
        }
        for row in previous.itertuples()
    ]


def get_ckan_obis_records(ipt_urls, erddap_url=None):
    """Match OBIS datasets to CKAN records, one row per matched dataset.

    Parameters
    ----------
    ipt_urls : dict[str, str | None]
        OBIS dataset UUID -> the ``url`` (IPT resource page) from its OBIS
        dataset metadata.
    erddap_url : str, optional
        The datasets' source key in cde.datasets; when CKAN is unreachable the
        datasets fall back to the CKAN metadata stored there by a previous
        harvest.

    Returns
    -------
    pd.DataFrame
        Columns: dataset_id, ckan_id, ckan_eovs, ckan_title, title_fr
    """
    log = run_logger(logger)
    try:
        records = list_ckan_records(False, OBIS_RECORDS_QUERY)
    except (requests.RequestException, RuntimeError, KeyError) as e:
        log.warning("CKAN unavailable, falling back to stored CKAN metadata: %s", e)
        rows = _stored_ckan_rows(list(ipt_urls), erddap_url) if erddap_url else []
        log.warning("%d OBIS datasets restored from stored CKAN metadata", len(rows))
        return pd.DataFrame(rows, columns=CKAN_OBIS_COLUMNS)

    by_uuid, by_ipt = {}, {}
    for record in records:
        for resource in record.get("resources", []):
            url = resource.get("url") or ""
            match = _OBIS_DATASET_URL.search(url.lower())
            if match:
                by_uuid.setdefault(match.group(1), record)
            key = ipt_resource_key(url)
            if key:
                by_ipt.setdefault(key, record)

    rows = []
    for dataset_id, ipt_url in ipt_urls.items():
        record = by_uuid.get(dataset_id) or by_ipt.get(ipt_resource_key(ipt_url or ""))
        if record:
            rows.append(_ckan_row(dataset_id, record))

    log.info("Matched %d / %d OBIS datasets to CKAN records", len(rows), len(ipt_urls))
    return pd.DataFrame(rows, columns=CKAN_OBIS_COLUMNS)
