#!/usr/bin/env python


import re
from urllib.parse import urlencode

import diskcache as dc
import pandas as pd
import requests
from prefect import get_run_logger, task
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# National CKAN has all the regions' records
CKAN_API_URL = "https://catalogue.cioos.ca/api/3"

# Transient statuses worth retrying (CKAN's Cloudflare/Caddy returns these intermittently).
_RETRY_STATUSES = (408, 429, 500, 502, 503, 504, 520, 522, 524)


def _build_ckan_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=4,
        backoff_factor=1.0,         # waits 0s, 2s, 4s, 8s between attempts
        status_forcelist=_RETRY_STATUSES,
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,      # let raise_for_status() give a clean error
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def _ckan_get_result(session, url):
    """GET a CKAN action endpoint and return its `result` (clear error on non-JSON)."""
    resp = session.get(url, timeout=120)
    resp.raise_for_status()
    try:
        payload = resp.json()
    except requests.exceptions.JSONDecodeError as e:
        snippet = resp.text[:200].replace("\n", " ").strip()
        raise RuntimeError(
            f"CKAN returned a non-JSON body (HTTP {resp.status_code}) for {url}: {snippet!r}"
        ) from e
    return payload["result"]


def split_erddap_url(url):
    """
    Split an ERDDAP URL into it's host and dataset ID

    Eg: split_erddap_url("https://data.cioospacific.ca/erddap/tabledap/IOS_BOT_Profiles.html")
    ('https://data.cioospacific.ca', 'IOS_BOT_Profiles')

    The split can also be done when the language is specified in the url, if it follows this example:
    https://cnodc-cndoc.azure.cloud-nuage.dfo-mpo.gc.ca/erddap/fr/tabledap/cnodc_msc50_pacific.html
    """

    pattern = re.compile(r"/erddap/(?:[a-z]{2}/)?(?:tabledap|griddap)/")
    match = pattern.search(url)
    if match:
        erddap_host, f = re.split(pattern, url, maxsplit=1)
    else:
        error_message = f"Invalid URL format: {url}"
        raise ValueError(error_message)

    # ERDDAP datasetIDs have no dots, so this drops any extension, query or fragment.
    dataset_id = re.match(r"[^/?#.]*", f).group()
    if not dataset_id:
        raise ValueError(f"Invalid URL format: {url}")
    return (erddap_host, dataset_id)


def erddap_join_key(url):
    """Scheme/case-insensitive key so http/https variants of one server still join."""
    return re.sub(r"^https?://", "", url.strip().lower()).rstrip("/")


def unescape_ascii_list(values):
    return [unescape_ascii(x) for x in values]


def unescape_ascii(x):
    try:
        return bytes(x, "ascii").decode("unicode-escape")
    except Exception:
        return x


@task(task_run_name="fetch-ckan-metadata")
def get_ckan_records(dataset_ids, limit=None, cache=False):
    """Fetch the full CKAN record for each harvested dataset ID (@task)."""
    records = list_ckan_records_with_erddap_urls(cache)

    # just used for testing
    if limit:
        records = records[0:limit]
    out = []
    for record_full in records:
        # A record can list several datasets; keep every ERDDAP resource.
        links = []
        for resource in record_full["resources"]:
            url = resource["url"]
            try:
                (erddap_host, dataset_id) = split_erddap_url(url)
            except ValueError:
                continue
            # dataset_ids could be None if user wants all
            if dataset_ids and dataset_id not in dataset_ids:
                continue
            links.append((erddap_host, dataset_id, "?" in url))
        if not links:
            continue

        # retreive the data for each record

        title_translated = record_full.get("title_translated")
        # Kept for the commented-out ckan_summary fields below.
        notes_translated = record_full.get("notes_translated")  # noqa: F841

        def remove_newlines(s):
            # not sure why all these are needed but they seem to be
            s = s.replace("\r", "")
            s = s.replace("\n", "")
            s = s.replace("\\n", "")
            s = s.replace("\\r", "")
            return s

        ckan_record_text = {
            "title": title_translated.get("en"),
            "title_fr": title_translated.get("fr"),
            # "ckan_summary": notes_translated.get("en"),
            # "ckan_summary_fr": notes_translated.get("fr"),
        }

        for k, v in ckan_record_text.items():
            ckan_record_text[k] = remove_newlines(unescape_ascii(v))

        organizations = []

        for contact in record_full.get("cited-responsible-party", []):
            organizations += [unescape_ascii(contact.get("organisation-name"))]

        # remove duplicates, empty strings
        organizations = list(filter(None, set(organizations)))

        for erddap_host, dataset_id, is_subset in links:
            out.append(
                [
                    erddap_host + "/erddap",
                    dataset_id,
                    record_full["id"],
                    organizations,
                    ckan_record_text,
                    is_subset,
                ],
            )

    line = {
        "erddap_url": [x[0].strip("/") for x in out],
        "dataset_id": [x[1] for x in out],
        "ckan_id": [x[2] for x in out],
        "ckan_organizations": [x[3] for x in out],
        "ckan_title": [x[4]["title"] for x in out],
        "title_fr": [x[4]["title_fr"] for x in out],
        # "ckan_summary": [x[4]["ckan_summary"] for x in out],
        # "ckan_summary_fr": [x[4]["ckan_summary_fr"] for x in out],
        "is_subset": [x[5] for x in out],
    }

    df = pd.DataFrame(line)

    if not df.empty:
        # When several records cite one dataset, prefer one linking the whole
        # dataset over a per-cruise record linking a query-string subset of it.
        df = (
            df.sort_values("is_subset", kind="stable")
            .drop_duplicates(subset=["erddap_url", "dataset_id"])
            .sort_index()
        )
    return df.drop(columns="is_subset")


def list_ckan_records_with_erddap_urls(cache_requests):
    """Fetch all CKAN records with ERDDAP urls (paged)."""
    try:
        logger = get_run_logger()
    except Exception:
        import logging as _logging
        logger = _logging.getLogger(__name__)
    logger.info(f"cache_requests: {cache_requests}")
    row_page_limit = 1000
    row_start = 0
    # count total records avaiable, but we will have to page queries to get all results
    # 1000 records per query (or as defined on the server)
    records_remaining = 1
    records_total = []
    session = _build_ckan_session()
    while records_remaining:
        # Search the indexed resource URLs: free-text "erddap" misses records
        # (most of OGSL's) that only mention ERDDAP in a resource link.
        erddap_datasets_query = (
            CKAN_API_URL
            + "/action/package_search?"
            + urlencode({"rows": row_page_limit, "start": row_start, "q": "res_url:*erddap*"})
        )
        logger.info(erddap_datasets_query)
        # print(erddap_datasets_query)
        logger.info(f"erddap_dataset_query:\n{erddap_datasets_query}")
        if cache_requests:
            logger.info("checking for ckan cache")
            # limit cache to 10gb
            cache = dc.Cache(
                "ckan_harvester_cache",
                eviction_policy="none",
                size_limit=10000000000,
                cull_limit=0,
            )
            logger.info("Cache stats:")
            logger.info(f"eviction_policy: {cache.eviction_policy}")
            logger.info(f"count: {cache.count}")
            logger.info(f"volume: {cache.volume()}")
            logger.info(f"size_limit {cache.size_limit}")
            if erddap_datasets_query in cache:
                logger.info("Cached CKAN records found")
                result = cache[erddap_datasets_query]

            else:
                result = _ckan_get_result(session, erddap_datasets_query)
                cache[erddap_datasets_query] = result
                logger.info("Cached CKAN records")
        else:
            result = _ckan_get_result(session, erddap_datasets_query)

        # count of total records, regardless of paging
        count_total = result["count"]
        # count of records in this page, eg < 1000
        records_total += result["results"]
        count_page = len(records_total)
        records_remaining = count_total - count_page
        row_start += row_page_limit

    print("Found", len(records_total), " CKAN records")

    return records_total
