import json
import os

import pandas as pd


def get_eov_to_standard_names():
    dir = os.path.dirname(os.path.realpath(__file__))
    supported_eovs = pd.read_csv(dir + "/supported_eovs.csv")["goos_eov"].to_list()

    with open(dir + "/eovs_to_standard_name.json") as f:
        eov_to_standard_names = json.loads(f.read())
        return {
            k: eov_to_standard_names[k]
            for k in eov_to_standard_names
            if k in supported_eovs
        }


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


def get_ceda_eov_map():
    dir = os.path.dirname(os.path.realpath(__file__))
    return pd.read_csv(dir + "/supported_eovs.csv").set_index("goos_eov")


ceda_eov_map = get_ceda_eov_map()


def eovs_to_ceda_eovs(lst):
    print("lst", lst)
    out = []
    for eov in lst:
        out += [ceda_eov_map.loc[eov]["ceda_eov"]]
    return out
