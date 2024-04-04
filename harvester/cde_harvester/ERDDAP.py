#!/usr/bin/env python3

# The ERDDAP class contains functions relating to querying the ERDDAP server

import re
from io import StringIO
from urllib.parse import unquote, urlparse

import diskcache as dc
import pandas as pd
import requests
from cde_harvester.dataset import Dataset
from loguru import logger

# size in bytes
MAX_RESPONSE_SIZE = 1e8


class ERDDAP:
    "Stores the ERDDAP server URL and functions related to querying it"

    def __init__(self, erddap_url, cache_requests=False):
        self.cache_requests = cache_requests

        if cache_requests:
            # limit cache to 10gb
            self.cache = dc.Cache(
                "harvester_cache",
                eviction_policy="none",
                size_limit=10000000000,
                cull_limit=0,
            )
            logger.debug("Cache stats:")
            logger.debug("eviction_policy {}", self.cache.eviction_policy)
            logger.debug("count {}", self.cache.count)
            logger.debug("volume() {}", self.cache.volume())
            logger.debug("size_limit {}", self.cache.size_limit)

        self.domain = urlparse(erddap_url).netloc
        self.session = requests.Session()

        self.logger = logger.bind(erddap_url=erddap_url)
        self.df_all_datasets = None

        erddap_url = erddap_url.rstrip("/")
        self.url = erddap_url

        if not re.search("^https?://", erddap_url):
            raise RuntimeError("URL Must start wih http or https")

        if not erddap_url.endswith("/erddap"):
            # ERDDAP URL almost always ends in /erddap
            logger.warning("URL doesn't end in /erddap, trying anyway")
        self.df_all_datasets = self.get_all_datasets()

        if self.df_all_datasets.empty:
            print("No datasets found at:", self.url)

    def __repr__(self):
        return f"ERDDAP({self.url})"

    def get_all_datasets(self):
        "Get a string list of dataset IDs from the ERDDAP server"
        # allDatasets indexes table and grid datasets
        try:
            df = self.erddap_csv_to_df(
                '/tabledap/allDatasets.csv?&accessible="public"&dataStructure="table"',
                skiprows=[1, 2],
            )
            return df
        except requests.exceptions.HTTPError:
            self.logger.error("ERDDAP query failed", exc_info=True)
            return pd.DataFrame()

    def parse_erddap_date(s):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
        is_timestamp = s.startswith("1.") or s.startswith("-1.")

        if is_timestamp:
            return pd.to_datetime(float(s), unit="s")

        return pd.to_datetime(s, errors="coerce")

    def parse_erddap_dates(series):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
        time = str(series.tolist()[0]).strip()
        is_timestamp = time.startswith("1.") or time.startswith("-1.")

        if is_timestamp:
            return pd.to_datetime(series.astype(float), unit="s")

        return pd.to_datetime(series, errors="coerce")

    def erddap_csv_to_df(self, url, skiprows=[1], dataset=None):
        """If theres an error in the request, this raises up to the dataset loop, so this dataset gets skipped"""
        if dataset:
            erddap_url = dataset.erddap_url
        else:
            erddap_url = self.url

        url_combined = erddap_url + url

        self.logger.debug(unquote(url_combined))

        response = None
        if self.cache_requests:
            cache = self.cache
            if url_combined in self.cache:
                response = cache[url_combined]
            else:
                self.logger.debug("CACHE MISS")
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
                self.logger.debug(
                    "Redirecting {} to {}", original_hostname, actual_hostname
                )
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
            self.self.logger.error(
                "OrderByCount not available within this ERDDAP Version"
            )
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
            self.logger.error("Query too big for the server")
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
            self.logger.error("Empty response")
            return pd.DataFrame()

    def get_dataset(self, dataset_id):
        return Dataset(self, dataset_id)
