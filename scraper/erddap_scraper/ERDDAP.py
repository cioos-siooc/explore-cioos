#!/usr/bin/env python3

# The ERDDAP class contains functions relating to querying the ERDDAP server

import logging
import re
from io import StringIO
from urllib.parse import unquote, urlparse

import pandas as pd
import requests

logging.getLogger("urllib3").setLevel(logging.WARNING)

from erddap_scraper.dataset import Dataset


class ERDDAP(object):
    "Stores the ERDDAP server URL and functions related to querying it"

    def __init__(self, erddap_url):
        super(ERDDAP, self).__init__()
        self.url = erddap_url
        self.session = requests.Session()
        self.domain = urlparse(erddap_url).netloc
        self.logger = self.get_logger()
        self.df_all_datasets = None
        logger = self.logger

        erddap_url = erddap_url.rstrip("/")

        if not re.search("^https?://", erddap_url):
            raise RuntimeError("URL Must start wih http or https")

        if not erddap_url.endswith("/erddap"):
            # ERDDAP URL almost always ends in /erddap
            logger.warning("URL doesn't end in /erddap, trying anyway")
        self.get_all_datasets()

    def get_session(self):
        "get the TCP session so it can be reused"
        return self.session

    def get_all_datasets(self):
        "Get a string list of dataset IDs from the ERDDAP server"
        # allDatasets indexes table and grid datasets
        df = self.erddap_csv_to_df(
            '/tabledap/allDatasets.csv?&accessible="public"', skiprows=[1, 2]
        )
        self.df_all_datasets = df

    def parse_erddap_dates(series):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
        is_timestamp = str(series.tolist()[0]).strip().startswith("1.")

        if is_timestamp:
            return pd.to_datetime(series, unit="s")

        return pd.to_datetime(series, errors="coerce")

    def erddap_csv_to_df(self, url, skiprows=[1],logger=None):
        """If theres an error in the request, this raises up to the dataset loop, so this dataset gets skipped"""
        if not logger:
            logger=self.logger
        
        url_combined = self.url + url 
        logger.debug(unquote(url_combined))

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
            return pd.read_csv(StringIO(response.text), skiprows=skiprows)
        if no_data:
            logger.error("Empty response")
            return pd.DataFrame()

    def get_dataset(self, dataset_id):
        return Dataset(self, dataset_id)

    def get_logger(self):
        logger = logging.getLogger(self.domain)
        # logging.basicConfig(format="%(name)s: %(message)s", level=logging.INFO)
        return logger
