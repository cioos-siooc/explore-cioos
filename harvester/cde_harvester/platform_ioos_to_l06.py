import logging

import pandas as pd
import requests

"""

CIOOS uses NERC L06 platform vocabulary, see http://vocab.nerc.ac.uk/collection/L06/current/
IOOS uses IOOS platform vocabulary, see https://mmisw.org/ont/ioos/platform

CDE converts IOOS to L06 using a mapping found here:  https://mmisw.org/ont?iri=http://mmisw.org/ont/bodc/MapSeaVoxPlatforms2IOOSandRDIPlatforms

"""

logger = logging.getLogger(__name__)


def get_l06_codes_and_labels():

    url = "http://vocab.nerc.ac.uk/collection/L06/current/?_profile=nvs&_mediatype=application/ld+json"
    logger.info("Downloading %s", url)
    platforms = requests.get(url).json()["@graph"]

    platforms_parsed = {}
    l06Lookup = {}

    for platform in platforms:
        # first entry describes the vocabulary, skip it
        if not "identifier" in platform:
            continue

        label = platform["prefLabel"]["@value"]
        broader = platform.get("broader", [])
        id = platform["@id"]
        found_parent_platform = False
        for url in broader:
            if "L06" in url:
                platforms_parsed[id] = {"broader_L06_url": url, "l06_label": label}
                found_parent_platform = True
                continue
        if not found_parent_platform:
            # this must be a platform category
            platforms_parsed[id] = {"broader_L06_url": id, "l06_label": label}
        l06Lookup[id] = label

    for l06_url_code, item in platforms_parsed.items():
        broaderL06 = item["broader_L06_url"]
        res = l06Lookup[broaderL06]
        platforms_parsed[l06_url_code]["category"] = res
    df = pd.DataFrame.from_dict(platforms_parsed, orient="index")
    del df["broader_L06_url"]
    df.index = df.index.str.split("/").str[-2]
    df.index.names = ["l06_code"]
    return df


def get_ioos_to_l06_mapping():
    # Parse IOOS to L06 mapping

    # download mapping
    url = "https://mmisw.org/ont/api/v0/ont?format=jsonld&iri=http://mmisw.org/ont/bodc/MapSeaVoxPlatforms2IOOSandRDIPlatforms"
    logger.info("Downloading %s", url)
    res = requests.get(url).json()
    rows = []
    # parse mapping
    for k in res["@graph"]:
        try:
            predicate = k.get("predicate", "").split(":")[-1]
            ioos_code = k.get("subject", "").split("/")[-1]
            nerc_l06_code = k.get("object", "").split("/")[-2]

            if ioos_code and nerc_l06_code:
                rows += [
                    {
                        "ioos_label": ioos_code,
                        "predicate": predicate,
                        "l06_code": nerc_l06_code,
                    }
                ]
        except IndexError:
            pass

    df = pd.DataFrame(rows)
    preference_list = ["exactMatch", "narrowMatch", "broadMatch", "relatedMatch"]
    df["Pref"] = pd.Categorical(
        df["predicate"], categories=preference_list, ordered=True
    )
    df = df.sort_values(["ioos_label", "Pref"]).drop_duplicates("ioos_label")
    df.drop(["Pref", "predicate"], axis=1, inplace=True)
    df.reset_index(inplace=True, drop=True)
    df = df.set_index("l06_code")
    return df


l06_codes_and_labels = get_l06_codes_and_labels()
ioos_to_l06_mapping = get_ioos_to_l06_mapping()

platforms_nerc_ioos = (
    l06_codes_and_labels.join(ioos_to_l06_mapping).reset_index().fillna("")
)
