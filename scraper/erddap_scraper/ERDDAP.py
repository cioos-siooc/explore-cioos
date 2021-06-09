#!/usr/bin/env python3

# The ERDDAP class contains functions relating to querying the ERDDAP server

import requests
import json
import re
from bs4 import BeautifulSoup
from .setup_logging import setup_logging

logger = setup_logging()


def erddap_json_to_dict_list(json):
    'turns ERDDAP style JSON output into list of dicts. See test for example'
    data = []
    for i, dataset in enumerate(json['table']['rows']):
        out = {}
        for j, field in enumerate(json['table']['columnNames']):
            out[field] = dataset[j]
        data.append(out)
    return data


class ERDDAP(object):
    'Stores the ERDDAP server URL and functions related to querying it'

    def __init__(self, erddap_url):
        super(ERDDAP, self).__init__()

        # remove trailing '/' from erddap url
        if erddap_url.endswith("/"):
            erddap_url = erddap_url[:-1]

        if not re.search("^https?://", erddap_url):
            raise RuntimeError("URL Must start wih http or https")

        if not erddap_url.endswith('/erddap'):
            # ERDDAP URL almost always ends in /erddap
            logger.warning("URL doesn't end in /erddap, trying anyway")

        self.url = erddap_url
        self.session = requests.Session()

    def get_session(self):
        'get the TCP session so it can be reused'
        return self.session

    def get_json_from_url(self, url):
        'fetches json from url using http(s)'
        url_complete = self.url + url
        logger.debug("Fetching " + url_complete)
        print("FETCH ",url_complete)
        try:
            response = self.session.get(url_complete)
            response.raise_for_status()
        except Exception as err:
            print(url)
            raise err

        a = response.json()
        return a

    def get_dataset_ids(self):
        'Get a string list of dataset IDs from the ERDDAP server'
        # allDatasets indexes table and grid datasets
        datasets_json = self.get_json_from_url(
            '/tabledap/allDatasets.json?datasetID&accessible="public"')

        # parse ERDDAP output
        datasets = list(map(lambda x: x[0], datasets_json['table']['rows']))

        # remove 'allDatasets' dataset, which is used to query datasets
        datasets.remove('allDatasets')
        return datasets

    def get_metadata_for_dataset(self, dataset_id):
        'get all the global and variable metadata for a dataset'
        url = "/info/"+dataset_id+"/index.json"
        # Get JSON representation of this dataset's metadata
        try:
            metadata_json = self.get_json_from_url(url)
        except Exception as err:
            raise err

        # transform this JSON to an easier to use format
        metadata = erddap_json_to_dict_list(metadata_json)
        vars = {}

        # data contains a mix of globals and variable attributes
        # group by variable first
        for var in metadata:

            varname = var['Variable Name']
            if varname not in vars.keys():
                vars[varname] = {}

            attr = var['Attribute Name']
            val = var['Value']

            # values are all strings
            if len(val) > 0:
                vars[varname][attr] = val

        # Separate globals versus variables
        metadata = {
            'globals': vars.pop('NC_GLOBAL'),
            'variables': vars
        }
        return metadata

    def scrape_contact_from_jsonld(self):
        '''
        TODO we may not end up needing this data!

        Scrape the json-ld from html of <erddap_url>/info/index.html

        This is an example of the data produced:
        {
          "@type": "Organization",
          "name": "Hakai Institute",
          "address": {
            "@type": "PostalAddress",
            "addressCountry": "Canada",
            "addressLocality": "PO Box 309, Heriot Bay",
            "addressRegion": "BC",
            "postalCode": "V0P 1H0"
          },
          "telephone": "5555555555",
          "email": "admin@hakai.org",
          "sameAs": "http://hakai.org"
        }

        '''
        url_add = "/info/index.html"
        # the json-ld is embedded inside the source html
        html = self.session.get(self.url + url_add).text
        soup = BeautifulSoup(html, "html5lib")
        # find the json-ld bit and strip the <script> tags
        jsonld_string = soup.find('script',
                                  {"type": "application/ld+json"}).text.strip()
        # parse the json string to a dict
        jsonld = json.loads(jsonld_string)
        publisher = jsonld['publisher']

        parsed = {
            'telephone': publisher["telephone"],
            'email': publisher["email"],
            'address': publisher["address"]
        }

        return parsed
