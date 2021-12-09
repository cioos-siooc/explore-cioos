#!/usr/bin/env python
# coding: utf-8


import json

import pandas as pd
import requests

# National CKAN has all the regions' records
CKAN_API_URL = "https://catalogue.cioos.ca/api/3"


def split_erddap_url(url):
    """
    Split an ERDDAP URL into it's host and dataset ID

    Eg: split_erddap_url("https://data.cioospacific.ca/erddap/tabledap/IOS_BOT_Profiles.html")
    ('https://data.cioospacific.ca', 'IOS_BOT_Profiles')
    """
    [erddap_host, f] = url.split("/erddap/tabledap/")
    dataset_id = f.split(".html")[0]
    return (erddap_host, dataset_id)


def get_ckan_records(record_id_erddap_url_map, limit=None):
    """
    Goes through the list of ERDDAP URLs and dataset IDs and gets the full CKAN record for each dataset ID

    This will take a few minutes

    """

    # just used for testing
    if limit:
        record_id_erddap_url_map = record_id_erddap_url_map[0:limit]
    out = []
    for i, [package_id, url] in enumerate(record_id_erddap_url_map):
        if i % 100 == 0 and i > 0:
            print(i)
        # retreive the data for each record
        record_url = CKAN_API_URL + "/action/package_show?id=" + package_id
        record_full = requests.get(record_url).json()["result"]
        ckan_record_text = {
            "title": record_full.get("title"),
        }

        partiesRaw = [
            x["value"] for x in record_full["extras"] if x["key"] == "responsible-party"
        ]
        # remove empties
        partiesRaw = list(filter(None, partiesRaw))

        organizations = []

        if len(partiesRaw):
            partiesRaw2 = json.loads(partiesRaw[0])
            organizations = [x["name"] for x in partiesRaw2]
        else:
            cited_responsible_party = json.loads(record_full["cited-responsible-party"])
            if len(cited_responsible_party):
                for contact in cited_responsible_party:
                    if "organisation-name" in contact or "organization-name" in contact:
                        print(contact)
                        organizations += [contact.get("organisation-name")]

        # remove duplicates, empty strings
        organizations = list(filter(None, organizations))
        organizations = list(set(organizations))

        (erddap_host, dataset_id) = split_erddap_url(url)
        out.append(
            [
                erddap_host + "/erddap",
                dataset_id,
                record_full["eov"],
                record_full["id"],
                organizations,
                ckan_record_text,
            ],
        )

        # compile a dataframe
    line = {
        "erddap_url": [x[0].strip("/") for x in out],
        "dataset_id": [x[1] for x in out],
        "eovs": [x[2] for x in out],
        "ckan_id": [x[3] for x in out],
        "parties": [x[4] for x in out],
        "ckan_record": [x[5] for x in out],
    }

    df = pd.DataFrame(line)

    return df


def list_ckan_records_with_erddap_urls():
    erddap_datasets_query = (
        CKAN_API_URL + "/action/resource_search?query=url:/erddap/tabledap/"
    )
    record_id_erddap_url_map = [
        [x["package_id"], x["url"]]
        for x in requests.get(erddap_datasets_query).json()["result"]["results"]
    ]
    return record_id_erddap_url_map
