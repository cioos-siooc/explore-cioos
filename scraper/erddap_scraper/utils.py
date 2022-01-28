import json
import os

import pandas as pd


def get_eov_to_standard_names():
    dir = os.path.dirname(os.path.realpath(__file__))

    with open(dir + "/eovs_to_standard_name.json") as f:
        eov_to_standard_names = json.loads(f.read())
        return eov_to_standard_names


def get_df_eov_to_standard_names():
    df = pd.DataFrame()
    for eov, names in eov_to_standard_names.items():
        for name in names:
            df = pd.concat(
                [df, pd.DataFrame({"eov": [eov], "standard_name": [name]})],
                ignore_index=True,
            )
    return df


def intersection(lst1, lst2):
    """
    intersection doesnt include nulls
    """
    lst3 = [value for value in lst1 if value in lst2 and value != ""]
    return lst3


def flatten(t):
    return [item for sublist in t for item in sublist]


cf_standard_names = (
    pd.read_xml(
        "https://cfconventions.org/Data/cf-standard-names/78/src/cf-standard-name-table.xml"
    )
    .sort_values(by="id")["id"]
    .unique()
)

eov_to_standard_names = get_eov_to_standard_names()
supported_standard_names = flatten(list(eov_to_standard_names.values()))
