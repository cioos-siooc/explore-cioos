#!/usr/bin/env python3

# The ERDDAP class contains functions relating to querying the ERDDAP server

import logging
import re
from io import StringIO
from urllib.parse import unquote, urlparse

import diskcache as dc
import pandas as pd
import requests

logging.getLogger("urllib3").setLevel(logging.WARNING)
from erddap_scraper.dataset import Dataset


class ERDDAP(object):
    "Stores the ERDDAP server URL and functions related to querying it"

    def __init__(self, erddap_url, cache_requests=False):
        super(ERDDAP, self).__init__()
        self.cache_requests = cache_requests

        if cache_requests:
            # limit cache to 10gb
            self.cache = dc.Cache(
                "erddap_scraper_dc",
                eviction_policy="none",
                size_limit=10000000000,
                cull_limit=0,
            )
            print("Cache stats:")
            print("eviction_policy", self.cache.eviction_policy)
            print("count", self.cache.count)
            print("volume()", self.cache.volume())
            print("size_limit", self.cache.size_limit)

        self.url = erddap_url
        self.domain = urlparse(erddap_url).netloc
        self.session = requests.Session()

        self.logger = self.get_logger()
        self.df_all_datasets = None
        logger = self.logger

        erddap_url = erddap_url.rstrip("/")

        if not re.search("^https?://", erddap_url):
            raise RuntimeError("URL Must start wih http or https")

        if not erddap_url.endswith("/erddap"):
            # ERDDAP URL almost always ends in /erddap
            logger.warning("URL doesn't end in /erddap, trying anyway")
        self.df_all_datasets = self.get_all_datasets()

        if self.df_all_datasets.empty:
            raise Exception("No datasets found at:", self.url)

    def get_all_datasets(self):
        "Get a string list of dataset IDs from the ERDDAP server"
        # allDatasets indexes table and grid datasets
        df = self.erddap_csv_to_df(
            '/tabledap/allDatasets.csv?&accessible="public"', skiprows=[1, 2]
        )
        return df

    def parse_erddap_date(s):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
        is_timestamp = s.startswith("1.")

        if is_timestamp:
            return pd.to_datetime(s, unit="s")

        return pd.to_datetime(s, errors="coerce")

    def parse_erddap_dates(series):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
        is_timestamp = str(series.tolist()[0]).strip().startswith("1.")

        if is_timestamp:
            return pd.to_datetime(series, unit="s")

        return pd.to_datetime(series, errors="coerce")

    def erddap_csv_to_df(self, url, skiprows=[1], logger=None):
        """If theres an error in the request, this raises up to the dataset loop, so this dataset gets skipped"""
        if not logger:
            logger = self.logger

        url_combined = self.url + url
        logger.debug(unquote(url_combined))

        # response = self.session.get(url_combined)

        response = None
        if self.cache_requests:
            cache = self.cache
            if url_combined in self.cache:
                response = cache[url_combined]
            else:
                logger.debug("CACHE MISS")
                response = self.session.get(url_combined)
                cache[url_combined] = response
        else:
            response = self.session.get(url_combined)

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
