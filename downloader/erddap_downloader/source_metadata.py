"""Each source's own metadata record, copied as is into the dataset's folder.

Best-effort: a record that can't be fetched becomes a warning on the subset,
never a failed download.
"""

import json
from pathlib import Path

import requests

from erddap_downloader.formats import REQUEST_HEADERS

CKAN_PACKAGE_API = "https://catalogue.cioos.ca/api/3/action/package_show"
OBIS_DATASET_API = "https://api.obis.org/v3/dataset/{dataset_id}"
TIMEOUT = 60


def _get(url, **params):
    response = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=TIMEOUT)
    response.raise_for_status()
    return response


def _erddap(dataset, folder: Path):
    url = f"{dataset['erddap_url']}/tabledap/{dataset['dataset_id']}.nccsvMetadata"
    (folder / "erddap.nccsvMetadata").write_bytes(_get(url).content)


def _ckan(ckan_id, folder: Path):
    package = _get(CKAN_PACKAGE_API, id=ckan_id).json()["result"]
    # The ISO 19115-3 record CKAN harvested this dataset from. The catalogue's
    # own /dataset/<id>.xml sits behind a bot challenge.
    if package.get("xml_location_url"):
        (folder / "ckan_iso19115.xml").write_bytes(_get(package["xml_location_url"]).content)
    else:
        (folder / "ckan_package.json").write_text(json.dumps(package, indent=2, ensure_ascii=False))


def _obis(dataset_id, folder: Path):
    results = _get(OBIS_DATASET_API.format(dataset_id=dataset_id)).json().get("results") or [{}]
    record = results[0]
    (folder / "obis_dataset.json").write_text(json.dumps(record, indent=2, ensure_ascii=False))
    # IPT resource pages are .../resource?r=<name>; the EML lives at eml.do.
    if "/resource?r=" in (record.get("url") or ""):
        (folder / "eml.xml").write_bytes(_get(record["url"].replace("/resource?", "/eml.do?")).content)


def save_source_metadata(dataset, folder: Path):
    """Write every record the dataset has; returns one warning per failure."""
    fetchers = []
    if dataset.get("source_type") == "obis":
        fetchers.append(("OBIS", lambda: _obis(dataset["dataset_id"], folder)))
    else:
        fetchers.append(("ERDDAP", lambda: _erddap(dataset, folder)))
    if dataset.get("ckan_id"):
        fetchers.append(("CKAN", lambda: _ckan(dataset["ckan_id"], folder)))

    warnings = []
    for label, fetch in fetchers:
        try:
            fetch()
        except (requests.RequestException, ValueError, KeyError, OSError) as e:
            warnings.append(f"{label} metadata record unavailable: {type(e).__name__}: {e}")
    return warnings
