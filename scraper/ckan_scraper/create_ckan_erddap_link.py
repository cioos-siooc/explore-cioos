#!/usr/bin/env python
# coding: utf-8


import json
import pandas as pd
import requests
import csv

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


def python_to_postgres_list(l):
    return str(l).replace("[", "{").replace("]", "}").replace("'", '"')


def get_ckan_records(record_id_erddap_url_map, limit=999999):
    """
    Goes through the list of ERDDAP URLs and dataset IDs and gets the full CKAN record for each dataset ID

    This will take a few minutes

    """
    out = []
    for [package_id, url] in record_id_erddap_url_map[0:limit]:

        # retreive the data for each record
        record_url = CKAN_API_URL + "/action/package_show?id=" + package_id
        record_full = requests.get(record_url).json()["result"]
        ckan_record_text = {
            "title": record_full.get("title"),
        }

        partiesRaw = [
            x["value"] for x in record_full["extras"] if x["key"] == "responsible-party"
        ]
        if len(partiesRaw):
            partiesRaw2 = json.loads(partiesRaw[0])
            organizations = [x["name"] for x in partiesRaw2]
        else:
            organizations = []

        (erddap_host, dataset_id) = split_erddap_url(url)
        out.append(
            [
                erddap_host + "/erddap",
                dataset_id,
                python_to_postgres_list(record_full["eov"]),
                record_full["id"],
                python_to_postgres_list(organizations),
                json.dumps(ckan_record_text),
            ],
        )

        # compile a dataframe
    line = {
        "erddap_url": [x[0] for x in out],
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


def main():
    """Run the CKAN scraper on CIOOS National"""
    # query CKAN national for all erddap datsets
    record_id_erddap_url_map = list_ckan_records_with_erddap_urls()

    # get all the linked CKAN records, set limit for testing, eg get_ckan_records(record_id_erddap_url_map,10)
    df = get_ckan_records(record_id_erddap_url_map)

    # Was tricky to import postgres arrays and json using comma separators, so I switched to "|"
    df.to_csv("erddap_ckan_mapping.csv", index=False, quoting=csv.QUOTE_NONE, sep="|")


if __name__ == "__main__":
    main()
