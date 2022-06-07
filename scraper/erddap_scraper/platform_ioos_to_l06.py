import pandas as pd
import requests

"""

CIOOS uses NERC L06 platform vocabulary, see http://vocab.nerc.ac.uk/collection/L06/current/
IOOS uses IOOS platform vocabulary, see https://mmisw.org/ont/ioos/platform

CDE converts IOOS to L06 using a mapping found here:  https://mmisw.org/ont?iri=http://mmisw.org/ont/bodc/MapSeaVoxPlatforms2IOOSandRDIPlatforms

"""


def get_l06_codes_and_labels():
    # parse NERC L06 to verify platform labels and map to IOOS
    url = "http://vocab.nerc.ac.uk/collection/L06/current/?_profile=dd&_mediatype=application/json"
    df = pd.read_json(url)
    df["l06_code"] = df.apply(lambda x: x["uri"].split("/")[-2], axis=1)
    df = df[["l06_code", "prefLabel"]].set_index("l06_code")
    df.rename(columns={"prefLabel": "l06_label"}, inplace=True)
    return df


def get_ioos_to_l06_mapping():
    # Parse IOOS to L06 mapping

    # download mapping
    url = "https://mmisw.org/ont/api/v0/ont?format=jsonld&iri=http://mmisw.org/ont/bodc/MapSeaVoxPlatforms2IOOSandRDIPlatforms"
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
