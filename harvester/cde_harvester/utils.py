import json
import logging
import os
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)


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
df_cde_eov_to_standard_name = get_df_cde_eov_to_standard_name(cde_eov_to_standard_name)


def intersection(lst1, lst2):
    """
    intersection doesnt include nulls
    """
    lst3 = [value for value in lst1 if value in lst2 and value != ""]
    return lst3


def flatten(t):
    return [item for sublist in t for item in sublist]


CF_STANDARD_NAMES_CSV = Path(__file__).parent / "data" / "cf_standard_names.csv"


def get_cf_names():
    if CF_STANDARD_NAMES_CSV.exists():
        logger.info("Loading existing CF standard names from %s", CF_STANDARD_NAMES_CSV)
        return pd.read_csv(CF_STANDARD_NAMES_CSV)["id"].unique()

    cf_names_xml_url = "https://cfconventions.org/Data/cf-standard-names/current/src/cf-standard-name-table.xml"
    logger.info("Downloading %s", cf_names_xml_url)

    cf_standard_names = (
        pd.read_xml(cf_names_xml_url).sort_values(by="id")["id"].unique()
    )
    return cf_standard_names


cf_standard_names = get_cf_names()


if __name__ == "__main__":
    """Download the latest CF standard names and save to local CSV cache.

    Usage: python -m cde_harvester.utils
    """
    logging.basicConfig(level=logging.INFO)
    cf_names_xml_url = "https://cfconventions.org/Data/cf-standard-names/current/src/cf-standard-name-table.xml"
    logger.info("Updating CF standard names from %s", cf_names_xml_url)
    cf_standard_names = pd.read_xml(cf_names_xml_url).sort_values(by="id")["id"].unique()
    CF_STANDARD_NAMES_CSV.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(cf_standard_names, columns=["id"]).to_csv(CF_STANDARD_NAMES_CSV, index=False)
    logger.info("Saved %d CF standard names to %s", len(cf_standard_names), CF_STANDARD_NAMES_CSV)

# list of standard names that are supported by CDE
supported_standard_names = flatten(cde_eov_to_standard_name.values())
