import json
import os

import pandas as pd


def get_cde_eov_to_standard_name():
    # get a dictionary with CDE EOVs as keys and a list of standard names under each
    # this hides the GOOS layer
    dir = os.path.dirname(os.path.realpath(__file__))

    with open(dir + "/cde_to_goos_eov.json") as f:
        cde_to_goos_eov = json.loads(f.read())

    with open(dir + "/goos_eov_to_standard_name.json") as f:
        goos_eov_to_standard_name = json.loads(f.read())

    res = {}
    for cde_eov, goos_eovs in cde_to_goos_eov.items():
        res[cde_eov] = []
        for goos_variable in goos_eovs:
            res[cde_eov] = list(
                set(res[cde_eov] + goos_eov_to_standard_name[goos_variable])
            )
    return res


# dictionary mapping from CDE ocean variables to standard names
cde_eov_to_standard_name = get_cde_eov_to_standard_name()


def get_df_cde_eov_to_standard_name(cde_eov_to_standard_name):
    # this is just a dataframe version of get_cde_eov_to_standard_name
    res = []
    for cde_eov, standard_names in cde_eov_to_standard_name.items():
        for standard_name in standard_names:
            res += [[cde_eov, standard_name]]
    return pd.DataFrame(res, columns=["eov", "standard_name"])


# dataframe mapping of CDE ocean variables to standard names
df_cde_eov_to_standard_name = get_df_cde_eov_to_standard_name(
    cde_eov_to_standard_name
)


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

# list of standard names that are supported by CDE
supported_standard_names = flatten(cde_eov_to_standard_name.values())
