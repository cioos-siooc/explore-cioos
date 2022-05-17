import json
import os

import pandas as pd


def get_ocean_variables_to_standard_names():
    # get a dictionary with CDE EOVs as keys and a list of standard names under each
    # this hides the GOOS layer
    dir = os.path.dirname(os.path.realpath(__file__))

    with open(dir + "/ocean_variables_to_goos.json") as f:
        ocean_variables_to_goos = json.loads(f.read())

    with open(dir + "/goos_to_standard_name.json") as f:
        goos_to_standard_names = json.loads(f.read())

    res = {}
    for ocean_variable, goos_variables in ocean_variables_to_goos.items():
        res[ocean_variable] = []
        for goos_variable in goos_variables:
            res[ocean_variable] = list(
                set(res[ocean_variable] + goos_to_standard_names[goos_variable])
            )
    return res


# dictionary mapping from CDE ocean variables to standard names
ceda_eovs_to_standard_names = get_ocean_variables_to_standard_names()


def get_df_ceda_eov_to_standard_name(ocean_variable_to_standard_names):
    # this is just a dataframe version of get_ocean_variables_to_standard_names
    res = []
    for ocean_variable, standard_names in ocean_variable_to_standard_names.items():
        for standard_name in standard_names:
            res += [[ocean_variable, standard_name]]
    return pd.DataFrame(res, columns=["eov", "standard_name"])


# dataframe mapping of CDE ocean variables to standard names
df_ceda_eov_to_standard_name = get_df_ceda_eov_to_standard_name(
    ceda_eovs_to_standard_names
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
supported_standard_names = flatten(ceda_eovs_to_standard_names.values())
