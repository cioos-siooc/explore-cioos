"""Fetch CKAN metadata for OBIS datasets.

Queries the CIOOS CKAN instance for each OBIS dataset UUID by searching
for it in the ``xml_location_url`` field. Returns a DataFrame that can
be joined onto harvested OBIS datasets to enrich them with EOVs,
French titles, and CKAN IDs.
"""

import gzip
import json
import logging
import os

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


def _read_cache(path):
    gz = path + ".gz"
    try:
        if os.path.isfile(gz):
            with gzip.open(gz, "rt") as f:
                return json.load(f)
        if os.path.isfile(path):
            with open(path) as f:
                return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Corrupt cache file %s, will re-fetch: %s", path, e)
    return None  # not cached or corrupt


def _write_cache(path, data):
    with gzip.open(path + ".gz", "wt") as f:
        json.dump(data, f)


def get_ckan_obis_records(dataset_ids, ckan_api_url=CKAN_API_URL, cache_folder=None):
    """Fetch CKAN metadata for a list of OBIS dataset UUIDs.

    Parameters
    ----------
    dataset_ids : list[str]
        OBIS dataset UUIDs to look up.
    ckan_api_url : str
        Base URL of the CKAN API.
    cache_folder : str, optional
        Directory to cache per-dataset CKAN lookups as gzip JSON.
        Uses the same folder as occurrence cache when provided.

    Returns
    -------
    pd.DataFrame
        Columns: dataset_id, ckan_id, ckan_eovs, ckan_title, title_fr
    """
    if cache_folder:
        os.makedirs(cache_folder, exist_ok=True)

    records = []
    total = len(dataset_ids)
    fetched = 0
    for i, dataset_id in enumerate(dataset_ids, 1):
        if i % 50 == 0 or i == total:
            logger.info("CKAN lookup progress: %d/%d", i, total)

        pkg = None
        cache_file = os.path.join(cache_folder, f"ckan_{dataset_id}.json") if cache_folder else None

        if cache_file:
            cached = _read_cache(cache_file)
            if cached is not None:  # None means not cached; False/dict are valid hits
                pkg = cached if cached else None
            else:
                pkg = _lookup_ckan_package(dataset_id, ckan_api_url)
                fetched += 1
                # Store False for "looked up but not found" to avoid re-fetching
                _write_cache(cache_file, pkg or False)
        else:
            pkg = _lookup_ckan_package(dataset_id, ckan_api_url)
            fetched += 1

        if not pkg:
            logger.debug("No CKAN record found for %s", dataset_id)
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

    logger.info(
        "Matched %d / %d OBIS datasets to CKAN records (%d fetched, %d from cache)",
        len(df), len(dataset_ids), fetched, len(dataset_ids) - fetched,
    )
    return df
