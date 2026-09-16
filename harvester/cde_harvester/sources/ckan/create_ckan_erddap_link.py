#!/usr/bin/env python

"""Enumerate the CIOOS CKAN catalogue and link its records to harvested data.

CKAN is CDE's *metadata* source: one instance describes the datasets published
by the *data* sources (ERDDAP servers, OBIS). This module pages that catalogue
once per run and turns it into a flat inventory — one row per (record, data
link) — which serves three consumers:

  * ERDDAP enrichment  (:func:`ckan_erddap_links`)
  * OBIS enrichment    (:func:`ckan_obis_links`)
  * the persisted ``cde.ckan_records`` snapshot behind the harvest dashboard's
    coverage report, which answers "what does CKAN describe that CDE does not
    serve, and what does CDE serve that CKAN has no record of?"

The catalogue is enumerated in FULL — there is deliberately no ``q=`` search
filter. A record with no data link at all is still a row (with a null
``erddap_url``/``obis_dataset_id``), because "CKAN describes this but nothing
points at data we can read" is one of the answers the report exists to give.
"""

import re
from datetime import datetime, timezone

import diskcache as dc
import pandas as pd
import requests
from cde_harvester.core.config import ckan_api_url
from prefect import get_run_logger, task
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Columns of the flat catalogue inventory. Mirrors cde.ckan_records in
# database/1_schema.sql (minus `pk`, which the DB supplies, and `snapshot_at`,
# which fetch_ckan_catalogue stamps on) and CkanRecordSchema in core/schemas.py.
CKAN_RECORD_COLUMNS = [
    "ckan_id",
    "ckan_name",
    "title",
    "title_fr",
    "organizations",
    "eovs",
    "erddap_url",
    "dataset_id",
    "obis_dataset_id",
    "n_resources",
]

# CKAN caps `rows` server-side; 1000 is the documented ceiling on cioos.ca.
PAGE_SIZE = 1000

# Transient statuses worth retrying (CKAN's Cloudflare/Caddy returns these intermittently).
_RETRY_STATUSES = (408, 429, 500, 502, 503, 504, 520, 522, 524)

# OBIS records carry their dataset UUID in xml_location_url (.../<uuid>.xml).
# The UUID alone is NOT a discriminator: every CIOOS record has an
# xml_location_url naming its own metadata file, so matching on the pattern
# alone tagged 488 ordinary records (geology, etc.) as OBIS datasets. The
# harvest source is the real discriminator — the same one the per-dataset
# lookup this replaced filtered on — and it is a Solr index field rather than a
# package field, so it takes its own query (see fetch_obis_record_ids).
_OBIS_XML_RE = re.compile(
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.xml",
    re.IGNORECASE,
)

# CKAN harvest source carrying the OBIS metadata records.
OBIS_HARVEST_SOURCE = "obis-xml-harvest-demo"


def _logger():
    """Prefect's run logger inside a flow, a plain module logger outside one."""
    try:
        return get_run_logger()
    except Exception:
        import logging

        return logging.getLogger(__name__)


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

    pattern = re.compile(r"/erddap/(?:[a-z]{2}/)?tabledap/")
    match = pattern.search(url)
    if match:
        erddap_host, f = re.split(pattern, url, maxsplit=1)
    else:
        error_message = f"Invalid URL format: {url}"
        raise ValueError(error_message)

    dataset_id = f.split(".html")[0]
    return (erddap_host, dataset_id)


def unescape_ascii_list(values):
    return [unescape_ascii(x) for x in values]


def unescape_ascii(x):
    try:
        return bytes(x, "ascii").decode("unicode-escape")
    except Exception:
        return x


def remove_newlines(s):
    """Flatten a CKAN text field. Both real and literal escapes turn up in these."""
    if not isinstance(s, str):
        return s
    for token in ("\r", "\n", "\\n", "\\r"):
        s = s.replace(token, "")
    return s


def _clean_text(value):
    return remove_newlines(unescape_ascii(value)) if value is not None else None


def obis_uuid_from_xml_location(value):
    """Extract the OBIS dataset UUID from a CKAN record's xml_location_url."""
    if not isinstance(value, str):
        return None
    match = _OBIS_XML_RE.search(value)
    return match.group(1).lower() if match else None


def parse_ckan_package(record, obis_record_ids=frozenset()):
    """Turn one CKAN package into zero or more inventory rows.

    A record yields one row per ERDDAP ``tabledap`` resource, so a package
    publishing the same data on two servers is represented twice rather than
    collapsing to whichever resource happened to come last. A record with no
    ERDDAP resource still yields exactly one row — with a null ``erddap_url``
    — so the catalogue snapshot stays a complete census of CKAN.
    """
    title_translated = record.get("title_translated") or {}
    organizations = sorted(
        {
            unescape_ascii(contact.get("organisation-name"))
            for contact in record.get("cited-responsible-party") or []
            if contact.get("organisation-name")
        }
    )
    resources = record.get("resources") or []

    base = {
        "ckan_id": record.get("id"),
        "ckan_name": record.get("name"),
        "title": _clean_text(title_translated.get("en") or record.get("title")),
        "title_fr": _clean_text(title_translated.get("fr")),
        "organizations": organizations,
        "eovs": list(record.get("eov") or []),
        # Only for records the OBIS harvest source actually produced; every
        # other record's xml_location_url names its own metadata file.
        "obis_dataset_id": (
            obis_uuid_from_xml_location(record.get("xml_location_url"))
            if record.get("id") in obis_record_ids
            else None
        ),
        "n_resources": len(resources),
    }

    rows = []
    for resource in resources:
        url = resource.get("url") or ""
        if "tabledap" not in url:
            continue
        try:
            erddap_host, dataset_id = split_erddap_url(url)
        except ValueError:
            # A malformed tabledap URL is a metadata defect, not a harvest
            # failure — record the package without the link rather than drop it.
            _logger().warning(
                "CKAN record %s has an unparseable tabledap URL: %s",
                record.get("id"), url,
            )
            continue
        rows.append(
            {**base, "erddap_url": f"{erddap_host}/erddap".strip("/"), "dataset_id": dataset_id}
        )

    if not rows:
        rows.append({**base, "erddap_url": None, "dataset_id": None})
    return rows


def iter_ckan_packages(cache_requests=False, session=None):
    """Yield every package in the CKAN catalogue, one page at a time.

    A generator rather than a list: the previous implementation accumulated
    every raw record before parsing, which is untenable now that the whole
    catalogue is enumerated instead of the `q=erddap` subset. Callers keep the
    parsed rows (a handful of fields) and the raw page is released each loop.
    """
    logger = _logger()
    api_url = ckan_api_url()
    session = session or _build_ckan_session()
    cache = None
    if cache_requests:
        # limit cache to 10gb
        cache = dc.Cache(
            "ckan_harvester_cache",
            eviction_policy="none",
            size_limit=10000000000,
            cull_limit=0,
        )
        logger.info("Using CKAN request cache (volume=%s, count=%s)", cache.volume(), cache.count)

    start = 0
    seen = 0
    total = None
    while True:
        query = f"{api_url}/action/package_search?rows={PAGE_SIZE}&start={start}"
        logger.info("Fetching CKAN packages: %s", query)
        if cache is not None and query in cache:
            result = cache[query]
        else:
            result = _ckan_get_result(session, query)
            if cache is not None:
                cache[query] = result

        results = result.get("results") or []
        if total is None:
            total = result.get("count", 0)
            logger.info("CKAN catalogue holds %d records", total)
        if not results:
            break

        yield from results

        seen += len(results)
        start += PAGE_SIZE
        if seen >= total:
            break

    logger.info("Read %d CKAN records", seen)


def fetch_obis_record_ids(session=None):
    """CKAN package ids produced by the OBIS harvest source.

    One extra request, because harvest_source_title is a Solr filter field and
    not part of the package body — there is no way to tell an OBIS record from
    the enumerated records alone. Returns an empty set when the source does not
    exist on this CKAN, which is the honest answer: no OBIS records to link.
    """
    logger = _logger()
    session = session or _build_ckan_session()
    url = (
        f"{ckan_api_url()}/action/package_search"
        f"?fq=harvest_source_title:{OBIS_HARVEST_SOURCE}&rows=1000&fl=id"
    )
    try:
        result = _ckan_get_result(session, url)
    except (requests.RequestException, RuntimeError, KeyError) as e:
        # Never fail the harvest over the OBIS link: without it OBIS datasets
        # simply keep their own titles, which they are expected to do anyway.
        logger.warning("Could not list OBIS CKAN records (%s); treating as none", e)
        return frozenset()

    ids = frozenset(r["id"] for r in result.get("results") or [] if r.get("id"))
    logger.info(
        "CKAN harvest source %r holds %d OBIS record(s)", OBIS_HARVEST_SOURCE, len(ids)
    )
    return ids


@task(task_run_name="fetch-ckan-catalogue")
def fetch_ckan_catalogue(cache=False, limit=None) -> pd.DataFrame:
    """Page the whole CKAN catalogue into the flat inventory frame (@task)."""
    session = _build_ckan_session()
    obis_record_ids = fetch_obis_record_ids(session)

    rows = []
    for n, record in enumerate(iter_ckan_packages(cache_requests=cache, session=session), 1):
        rows.append(parse_ckan_package(record, obis_record_ids))
        if limit and n >= limit:
            break

    flat = [row for group in rows for row in group]
    df = pd.DataFrame(flat, columns=CKAN_RECORD_COLUMNS)
    # When CKAN was read, not when the rows were loaded: the dashboard reports
    # snapshot age, and a run that fetches no catalogue leaves the previous
    # snapshot (and its timestamp) in place.
    df["snapshot_at"] = datetime.now(timezone.utc)
    _logger().info(
        "CKAN catalogue: %d rows from %d records (%d linked to ERDDAP, %d to OBIS)",
        len(df), len(rows),
        int(df["erddap_url"].notna().sum()) if not df.empty else 0,
        int(df["obis_dataset_id"].notna().sum()) if not df.empty else 0,
    )
    return df


def ckan_erddap_links(catalogue: pd.DataFrame) -> pd.DataFrame:
    """Derive the ERDDAP enrichment frame from the catalogue snapshot.

    Deduplicated on (erddap_url, dataset_id) — the pair this is joined on in
    merge_and_write_csvs. Deduplicating on dataset_id alone silently dropped
    the same dataset ID published by a second ERDDAP server.
    """
    columns = ["erddap_url", "dataset_id", "ckan_id", "ckan_organizations", "ckan_title", "title_fr"]
    if catalogue.empty:
        return pd.DataFrame(columns=columns)

    linked = catalogue[catalogue["erddap_url"].notna()]
    if linked.empty:
        return pd.DataFrame(columns=columns)

    df = linked.rename(columns={"organizations": "ckan_organizations", "title": "ckan_title"})[columns]
    return df.drop_duplicates(subset=["erddap_url", "dataset_id"]).reset_index(drop=True)


def ckan_obis_links(catalogue: pd.DataFrame) -> pd.DataFrame:
    """Derive the OBIS enrichment frame from the catalogue snapshot.

    Keyed on the OBIS dataset UUID, which CKAN carries in xml_location_url.
    """
    columns = ["dataset_id", "ckan_id", "ckan_eovs", "ckan_title", "title_fr"]
    if catalogue.empty:
        return pd.DataFrame(columns=columns)

    linked = catalogue[catalogue["obis_dataset_id"].notna()]
    if linked.empty:
        return pd.DataFrame(columns=columns)

    # Drop the ERDDAP dataset_id first: renaming obis_dataset_id onto it would
    # otherwise leave two columns of that name, and the selection below would
    # return both.
    df = linked.drop(columns=["dataset_id"]).rename(
        columns={"obis_dataset_id": "dataset_id", "eovs": "ckan_eovs", "title": "ckan_title"}
    )[columns]
    return df.drop_duplicates(subset=["dataset_id"]).reset_index(drop=True)
