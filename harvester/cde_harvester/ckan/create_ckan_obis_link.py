"""Fetch CKAN metadata for OBIS datasets.

Queries the CIOOS CKAN instance for each OBIS dataset UUID by searching
for it in the ``xml_location_url`` field. Returns a DataFrame that can
be joined onto harvested OBIS datasets to enrich them with EOVs,
French titles, and CKAN IDs.
"""

import logging

import pandas as pd
import requests

logger = logging.getLogger(__name__)

CKAN_API_URL = "https://cioos-national-ckan.preprod.ogsl.ca/api/3"
HARVEST_SOURCE = "obis-xml-harvest-demo"


def _lookup_ckan_package(dataset_id, ckan_api_url=CKAN_API_URL):
    """Look up a single OBIS dataset in CKAN by its UUID.

    Searches for the UUID in the xml_location_url field
    (e.g. ``.../<dataset_id>.xml``).
    """
    url = (
        f"{ckan_api_url}/action/package_search"
        f"?fq=harvest_source_title:{HARVEST_SOURCE}"
        f"&q=xml_location_url:*{dataset_id}.xml"
        f"&rows=1"
    )
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        results = response.json()["result"]["results"]
        return results[0] if results else None
    except Exception as e:
        logger.warning("CKAN lookup failed for %s: %s", dataset_id, e)
        return None


def get_ckan_obis_records(dataset_ids, ckan_api_url=CKAN_API_URL):
    """Fetch CKAN metadata for a list of OBIS dataset UUIDs.

    Parameters
    ----------
    dataset_ids : list[str]
        OBIS dataset UUIDs to look up.
    ckan_api_url : str
        Base URL of the CKAN API.

    Returns
    -------
    pd.DataFrame
        Columns: dataset_id, ckan_id, ckan_eovs, ckan_title, title_fr
    """
    records = []
    for dataset_id in dataset_ids:
        pkg = _lookup_ckan_package(dataset_id, ckan_api_url)
        if not pkg:
            logger.info("No CKAN record found for %s", dataset_id)
            continue

        title_translated = pkg.get("title_translated") or {}
        eovs = pkg.get("eov") or []

        records.append({
            "dataset_id": dataset_id,
            "ckan_id": pkg["id"],
            "ckan_eovs": eovs,
            "ckan_title": title_translated.get("en"),
            "title_fr": title_translated.get("fr"),
        })

    df = pd.DataFrame(records)
    if not df.empty:
        df = df.drop_duplicates(subset="dataset_id")

    logger.info("Matched %d / %d OBIS datasets to CKAN records", len(df), len(dataset_ids))
    return df
