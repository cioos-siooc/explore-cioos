#!/usr/bin/env python
# coding: utf-8


import diskcache as dc
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

def unescape_ascii(x):
    try:
        return bytes(x,'ascii').decode('unicode-escape')
    except Exception:
        return x

def get_ckan_records(dataset_ids, limit=None, cache=False):
    """
    Goes through the list of ERDDAP URLs and dataset IDs and gets the full CKAN record for each dataset ID

    This will take a few minutes

    dataset_ids are the list of datasets IDs that have been scraped
    """
    records = list_ckan_records_with_erddap_urls(cache)

    # just used for testing
    if limit:
        records = records[0:limit]
    out = []
    for i, record_full in enumerate(records):
        resources = record_full["resources"]
        erddap_url = ""
        for resource in resources:

            if "tabledap" in resource["url"]:
                erddap_url = resource["url"]
                continue
        if not erddap_url:
            continue

        (erddap_host, dataset_id) = split_erddap_url(erddap_url)
        
        # dataset_ids could be None if user wants all
        if dataset_ids and dataset_id not in dataset_ids:
            continue

        # retreive the data for each record

        title_translated = record_full.get("title_translated")
        notes_translated = record_full.get("notes_translated")

        def remove_newlines(s):
            # not sure why all these are needed but they seem to be
            s = s.replace('\r', "")
            s = s.replace('\n', "")
            s = s.replace('\\n', "")
            s = s.replace('\\r', "")
            return s

        ckan_record_text = {
            "title": title_translated.get("en"),
            "title_fr": title_translated.get("fr"),
            "ckan_summary": notes_translated.get("en"),
            "ckan_summary_fr": notes_translated.get("fr"),
        }

        for k,v in ckan_record_text.items():
            ckan_record_text[k]=remove_newlines(unescape_ascii(v))
    
        organizations = []

        for contact in record_full.get("cited-responsible-party",[]):
            organizations += [unescape_ascii(contact.get("organisation-name"))]

        # remove duplicates, empty strings
        organizations = list(filter(None, set(organizations)))

        out.append(
            [
                erddap_host + "/erddap",
                dataset_id,
                record_full["id"],
                organizations,
                ckan_record_text,
            ],
        )
        # compile a dataframe

    line = {
        "erddap_url": [x[0].strip("/") for x in out],
        "dataset_id": [x[1] for x in out],
        "ckan_id": [x[2] for x in out],
        "ckan_organizations": [x[3] for x in out],
        "ckan_title": [x[4]["title"] for x in out],
        "title_fr": [x[4]["title_fr"] for x in out],
        "ckan_summary": [x[4]["ckan_summary"] for x in out],
        "ckan_summary_fr": [x[4]["ckan_summary_fr"] for x in out],
    }
    

    df = pd.DataFrame(line)

    if not df.empty:
        df = df.drop_duplicates(subset="dataset_id")

    return df


def list_ckan_records_with_erddap_urls(cache_requests):
    row_page_limit = 1000
    row_start = 0
    # count total records avaiable, but we will have to page queries to get all results
    # 1000 records per query (or as defined on the server)
    records_remaining = 1
    records_total = []
    while records_remaining:
        erddap_datasets_query = (
            CKAN_API_URL
            + f"/action/package_search?rows={row_page_limit}&start={row_start}&q=erddap"
        )
        print(erddap_datasets_query)

        if cache_requests:
            # limit cache to 10gb
            cache = dc.Cache(
                "ckan_harvester_cache",
                eviction_policy="none",
                size_limit=10000000000,
                cull_limit=0,
            )
            if erddap_datasets_query in cache:
                result = cache[erddap_datasets_query]
            else:
                result = requests.get(erddap_datasets_query).json()["result"]
                cache[erddap_datasets_query] = result
        else:
            result = requests.get(erddap_datasets_query).json()["result"]

        # count of total records, regardless of paging
        count_total = result["count"]
        # count of records in this page, eg < 1000
        records_total += result["results"]
        count_page = len(records_total)
        records_remaining = count_total - count_page
        row_start += row_page_limit

    print("Found", len(records_total), " CKAN records")

    return records_total
