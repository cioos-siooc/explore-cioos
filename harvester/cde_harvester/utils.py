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
CF_STANDARD_NAMES_VERSION_FILE = Path(__file__).parent / "data" / "cf_standard_names_version.txt"
CF_NAMES_XML_URL = "https://cfconventions.org/Data/cf-standard-names/current/src/cf-standard-name-table.xml"


def get_cf_version_from_xml(url):
    """Fetch just the version number from the CF standard names XML."""
    import xml.etree.ElementTree as ET
    from urllib.request import urlopen

    with urlopen(url, timeout=10) as response:
        tree = ET.parse(response)
    return tree.getroot().find("version_number").text


def check_cf_version():
    """Warn if a newer version of CF standard names is available."""
    if not CF_STANDARD_NAMES_VERSION_FILE.exists():
        return
    local_version = CF_STANDARD_NAMES_VERSION_FILE.read_text().strip()
    try:
        remote_version = get_cf_version_from_xml(CF_NAMES_XML_URL)
        if remote_version != local_version:
            logger.warning(
                "CF standard names update available: local version %s, remote version %s. "
                "Run 'python -m cde_harvester.utils' to update.",
                local_version,
                remote_version,
            )
        else:
            logger.info("CF standard names version %s is up to date.", local_version)
    except Exception as e:
        logger.debug("Could not check for CF standard names updates: %s", e)


def get_cf_names():
    if CF_STANDARD_NAMES_CSV.exists():
        logger.info("Loading existing CF standard names from %s", CF_STANDARD_NAMES_CSV)
        check_cf_version()
        return pd.read_csv(CF_STANDARD_NAMES_CSV)["id"].unique()

    logger.info("Downloading %s", CF_NAMES_XML_URL)

    cf_standard_names = (
        pd.read_xml(CF_NAMES_XML_URL).sort_values(by="id")["id"].unique()
    )
    return cf_standard_names


cf_standard_names = get_cf_names()


if __name__ == "__main__":
    """Download the latest CF standard names and save to local CSV cache.

    Usage: python -m cde_harvester.utils
    """
    logging.basicConfig(level=logging.INFO)
    logger.info("Updating CF standard names from %s", CF_NAMES_XML_URL)
    version = get_cf_version_from_xml(CF_NAMES_XML_URL)
    cf_standard_names = pd.read_xml(CF_NAMES_XML_URL).sort_values(by="id")["id"].unique()
    CF_STANDARD_NAMES_CSV.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(cf_standard_names, columns=["id"]).to_csv(CF_STANDARD_NAMES_CSV, index=False)
    CF_STANDARD_NAMES_VERSION_FILE.write_text(version)
    logger.info("Saved %d CF standard names (version %s) to %s", len(cf_standard_names), version, CF_STANDARD_NAMES_CSV)

# list of standard names that are supported by CDE
supported_standard_names = flatten(cde_eov_to_standard_name.values())
