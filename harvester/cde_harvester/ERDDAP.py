#!/usr/bin/env python3

# The ERDDAP class contains functions relating to querying the ERDDAP server

import logging
import re
from io import StringIO
from urllib.parse import unquote, urlparse

import diskcache as dc
import pandas as pd
import requests
from prefect import get_run_logger
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
logging.getLogger("urllib3").setLevel(logging.WARNING)
from cde_harvester.dataset import Dataset

# size in bytes
MAX_RESPONSE_SIZE = 2e8

# Transient HTTP statuses we should retry. 500 is included even though some
# ERDDAPs use it semantically for "no data" / "query too big"; those responses
# have a body we still need to inspect, so the retry only kicks in when the
# server keeps returning 500 across attempts — i.e. it really is broken.
# 413 is here because seagull-erddap's WAF returns it when the harvester
# issues parallel requests too quickly; the queries themselves are tiny and
# succeed when retried after backoff.
# 408 (Request Timeout) and 520 (Cloudflare "unknown error") are transient
# timeouts seen on the cioosatlantic/cioospacific CTD-profile endpoints under
# load; the same queries succeed on a later attempt, so retry rather than skip.
_RETRY_STATUSES = (408, 413, 500, 502, 503, 504, 520, 522, 524)


def _build_retry_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=1.0,         # waits 0s, 2s, 4s between attempts
        status_forcelist=_RETRY_STATUSES,
        allowed_methods=frozenset(["GET", "HEAD"]),
        raise_on_status=False,      # let the existing 5xx-handling logic run
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class ERDDAP(object):
    "Stores the ERDDAP server URL and functions related to querying it"

    def __init__(self, erddap_url, cache_requests=False):
        super(ERDDAP, self).__init__()
        self.cache_requests = cache_requests

        if cache_requests:
            # limit cache to 10gb
            self.cache = dc.Cache(
                "harvester_cache",
                eviction_policy="none",
                size_limit=10000000000,
                cull_limit=0,
            )
            print("Cache stats:")
            print("eviction_policy", self.cache.eviction_policy)
            print("count", self.cache.count)
            print("volume()", self.cache.volume())
            print("size_limit", self.cache.size_limit)

        self.domain = urlparse(erddap_url).netloc
        self.session = _build_retry_session()

        self.logger = get_run_logger()
        self.df_all_datasets = None
        logger = self.logger

        erddap_url = erddap_url.rstrip("/")
        self.url = erddap_url
        if not re.search("^https?://", erddap_url):
            raise RuntimeError(f"URL Must start wih http or https: {erddap_url}")

        if not erddap_url.endswith("/erddap"):
            # ERDDAP URL almost always ends in /erddap
            logger.warning("URL doesn't end in /erddap, trying anyway")
        self.df_all_datasets = self.get_all_datasets()

        if self.df_all_datasets.empty:
            print("No datasets found at:", self.url)

    def get_all_datasets(self):
        "Get a string list of dataset IDs from the ERDDAP server"
        # allDatasets indexes table and grid datasets
        try:
            self.logger.info("Fetching all datasets from ERDDAP server: %s", self.url)
            df = self.erddap_csv_to_df(
                '/tabledap/allDatasets.csv?&accessible="public"&dataStructure="table"',
                skiprows=[1, 2],
            )
            self.logger.info(f"Found {len(df)} datasets")
            return df
        except requests.exceptions.HTTPError:
            self.logger.error("ERDDAP query failed", exc_info=True)
            return pd.DataFrame()

    def parse_erddap_date(s):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes.

        Always return tz-aware UTC. Without utc=True the epoch path returned
        naive timestamps and the ISO path returned aware ones, so downstream
        subtraction in get_count() raised tz-naive/tz-aware TypeErrors when
        the two bounds happened to come from different formats.
        """
        is_timestamp = s.startswith("1.") or s.startswith("-1.")

        if is_timestamp:
            return pd.to_datetime(s, unit="s", utc=True)

        return pd.to_datetime(s, errors="coerce", utc=True)

    def parse_erddap_dates(series):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
        time = str(series.tolist()[0]).strip()
        is_timestamp = time.startswith("1.") or time.startswith("-1.")

        if is_timestamp:
            return pd.to_datetime(series, unit="s", utc=True)

        return pd.to_datetime(series, errors="coerce", utc=True)

    def erddap_csv_to_df(self, url, skiprows=[1], dataset=None):
        """If theres an error in the request, this raises up to the dataset loop, so this dataset gets skipped"""
        if dataset:
            logger = dataset.logger
            erddap_url = dataset.erddap_url

        else:
            logger = self.logger
            erddap_url = self.url

        url_combined = erddap_url + url

        decoded_url = unquote(url_combined)
        logger.info(f"Requesting: {decoded_url}")
        # Record exactly what we requested so the dashboard can show the
        # admin a clickable, reproducible link list per dataset attempt.
        if dataset is not None:
            dataset.queried_urls.append(decoded_url)

        response = None
        if self.cache_requests:
            cache = self.cache
            if url_combined in self.cache:
                response = cache[url_combined]
            else:
                logger.debug("CACHE MISS")
                response = self.session.get(url_combined, timeout=3600)
                cache[url_combined] = response
        else:
            response = self.session.get(url_combined, timeout=3600)

        if len(response.content) > MAX_RESPONSE_SIZE:
            raise RuntimeError("Response too big")

        original_hostname = urlparse(url_combined).hostname
        actual_hostname = urlparse(response.url).hostname

        if original_hostname != actual_hostname:
            # redirect due to EDDTableFromErddap
            if dataset:
                logger.debug("Redirecting %s to %s", original_hostname, actual_hostname)
                dataset.erddap_url = response.url.split("/erddap")[0] + "/erddap"

        no_data = False
        # Newer erddaps respond with 404 for no data
        if response.status_code == 404:
            no_data = True
        elif (
            response.status_code == 500
            and "Query error: No operator found in constraint=&quot;orderByCount"
            in response.text
        ):
            logger.error("OrderByCount not available within this ERDDAP Version")
            no_data = True
        elif (
            # Older erddaps respond with 500 for no data
            response.status_code == 500
            and "Your query produced no matching results" in response.text
        ):
            no_data = True

        elif (
            response.status_code == 500
            and "You are requesting too much data." in response.text
        ):
            logger.error("Query too big for the server")
            no_data = True
        elif response.status_code != 200:
            # Report if not All OK
            response.raise_for_status()
        else:
            # skip units line
            return pd.read_csv(
                StringIO(response.text), skiprows=skiprows, encoding="unicode_escape"
            )
        if no_data:
            logger.error("Empty response")
            return pd.DataFrame()

    def get_dataset(self, dataset_id):
        return Dataset(self, dataset_id)

    def get_logger(self):
        logger = logging.getLogger(self.domain)
        return logger
