import json
import logging
import os
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import urlopen

import pandas as pd

logger = logging.getLogger(__name__)


def get_eov_to_standard_name():
    # EOV → CF standard names mapping (synced from cioos-commons/eovs/standard_names.json)
    dir = os.path.dirname(os.path.realpath(__file__))
    with open(dir + "/eov_standard_names.json") as f:
        return json.loads(f.read())


# dictionary mapping from ocean variables to standard names
eov_to_standard_name = get_eov_to_standard_name()


def get_df_eov_to_standard_name(eov_to_standard_name):
    res = []
    for eov, standard_names in eov_to_standard_name.items():
        for standard_name in standard_names:
            res += [[eov, standard_name]]
    return pd.DataFrame(res, columns=["eov", "standard_name"])


# dataframe mapping of ocean variables to standard names
df_eov_to_standard_name = get_df_eov_to_standard_name(eov_to_standard_name)


def get_standard_name_to_eovs(eov_to_standard_name):
    """Reverse of eov_to_standard_name: CF standard name -> list of EOV keys.

    Lets a single variable be tagged with the ocean variables it represents,
    which is how both the grid variable list and the per-feature EOV detection
    decide what a variable contributes.
    """
    res = {}
    for eov, standard_names in eov_to_standard_name.items():
        for standard_name in standard_names:
            res.setdefault(standard_name, []).append(eov)
    return res


# dictionary mapping from standard names to ocean variables
standard_name_to_eovs = get_standard_name_to_eovs(eov_to_standard_name)


def erddap_time_to_iso(value):
    """ERDDAP time value ('1.0257408E9' epoch seconds or an ISO 8601 string)
    -> ISO-8601 UTC string, or None when unparseable.

    ERDDAP publishes times in either format depending on the endpoint, and
    sometimes both within one response. Parsing per *value* matters: the
    column-level sniff in ERDDAP.parse_erddap_dates() reads only the first
    element, so a frame whose first row has an empty time sends a whole column
    of epoch seconds down the ISO branch, where pd.to_datetime reads them as
    nanoseconds and silently yields 1970.
    """
    s = str(value).strip()
    if not s or s.lower() in ("nan", "none", "nat"):
        return None
    try:
        ts = pd.to_datetime(float(s), unit="s", utc=True)
    except (TypeError, ValueError):
        ts = pd.to_datetime(s, errors="coerce", utc=True)
    if pd.isna(ts):
        return None
    return ts.isoformat()


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
CF_STANDARD_NAME_MODIFIERS = frozenset(
    {
        "detection_minimum",
        "number_of_observations",
        "standard_error",
        "status_flag",
    }
)


def get_cf_version_from_xml(url):
    """Fetch just the version number from the CF standard names XML."""
    with urlopen(url, timeout=10) as response:
        tree = ET.parse(response)
    version_element = tree.getroot().find("version_number")
    if version_element is None or not version_element.text:
        raise ValueError("CF standard names XML does not contain a version_number element")
    return version_element.text.strip()


# TODO: add pytest to verify check_cf_version detects when a newer CF standard names version is available
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
    if not CF_STANDARD_NAMES_CSV.exists():
        raise FileNotFoundError(
            f"CF standard names cache not found at {CF_STANDARD_NAMES_CSV}. "
            "Run 'python -m cde_harvester.utils' to download it."
        )
    logger.info("Loading CF standard names from %s", CF_STANDARD_NAMES_CSV)
    return pd.read_csv(CF_STANDARD_NAMES_CSV)["id"].unique()


cf_standard_names = get_cf_names()


def split_cf_standard_name(value):
    """Return a CF standard name and optional Appendix C modifier, if well formed."""
    if not isinstance(value, str):
        return None
    parts = value.split()
    if len(parts) == 1:
        return parts[0], None
    if len(parts) == 2 and parts[1] in CF_STANDARD_NAME_MODIFIERS:
        return parts[0], parts[1]
    return None


def is_cf_standard_name(value):
    """Whether value is a table name optionally followed by a valid CF modifier."""
    parsed = split_cf_standard_name(value)
    return parsed is not None and parsed[0] in cf_standard_names


def cf_standard_name_base(value):
    """Return a well-formed standard name's unmodified base, or None."""
    parsed = split_cf_standard_name(value)
    return parsed[0] if parsed else None


def eov_standard_name(value):
    """Return an unmodified name eligible to represent an EOV measurement."""
    parsed = split_cf_standard_name(value)
    if parsed is None or parsed[1] is not None:
        return None
    return parsed[0]


if __name__ == "__main__":
    """Download the latest CF standard names and save to local CSV cache.

    Usage: python -m cde_harvester.utils
    """
    logging.basicConfig(level=logging.INFO)
    check_cf_version()
    logger.info("Updating CF standard names from %s", CF_NAMES_XML_URL)

    with urlopen(CF_NAMES_XML_URL, timeout=30) as response:
        tree = ET.parse(response)
    root = tree.getroot()

    version_element = root.find("version_number")
    if version_element is None or not version_element.text:
        raise ValueError("CF standard names XML does not contain a version_number element")
    version = version_element.text.strip()

    names = sorted({entry.get("id") for entry in root.findall("entry") if entry.get("id")})

    CF_STANDARD_NAMES_CSV.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(names, columns=["id"]).to_csv(CF_STANDARD_NAMES_CSV, index=False)
    CF_STANDARD_NAMES_VERSION_FILE.write_text(version)
    logger.info("Saved %d CF standard names (version %s) to %s", len(names), version, CF_STANDARD_NAMES_CSV)

# list of standard names that are supported by CDE
supported_standard_names = flatten(eov_to_standard_name.values())
