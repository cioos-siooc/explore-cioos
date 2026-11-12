"""CKAN records no harvested ERDDAP or OBIS dataset cites, loaded as datasets
of their own: a footprint, extents and metadata, with no features."""

import json
import logging
import math
from datetime import UTC, datetime

import pandas as pd
from pandas.errors import OutOfBoundsDatetime
from prefect import task

from cde_harvester.core.errors import NO_SPATIAL_EXTENT, UNCHANGED
from cde_harvester.core.observability import run_logger
from cde_harvester.core.record_metadata import from_ckan
from cde_harvester.core.schemas import (
    DatasetSchema,
    HarvestAttemptSchema,
    SkippedDatasetSchema,
    VerifiedDatasetSchema,
)
from cde_harvester.sources.base import HarvestResult
from cde_harvester.sources.ckan.create_ckan_erddap_link import (
    list_ckan_records,
    record_organizations,
    record_titles,
)
from cde_harvester.sources.ckan.state import load_catalogue_state

logger = logging.getLogger(__name__)

# Sentinel erddap_url, as https://obis.org is OBIS's.
CKAN_SOURCE_URL = "https://catalogue.cioos.ca"

# Bump when the rows built from an unchanged record change, so the next run
# reloads them all instead of skipping them as unchanged.
CATALOGUE_VERSION = "1"


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _positions(coordinates):
    if coordinates and not isinstance(coordinates[0], list):
        yield coordinates
        return
    for part in coordinates or []:
        yield from _positions(part)


def _bbox(record):
    """From the record's `spatial` GeoJSON, the geometry CKAN's own search
    uses: its bbox-* fields have south and north swapped, or 0-360 longitudes,
    on hundreds of records."""
    spatial = record.get("spatial")
    try:
        geometry = json.loads(spatial) if isinstance(spatial, str) else spatial
        positions = [(_number(p[0]), _number(p[1])) for p in _positions(geometry["coordinates"])]
    except (TypeError, ValueError, KeyError, IndexError):
        return None
    if not positions or any(None in p for p in positions):
        return None
    lons = [lon - 360 if lon > 180 else lon for lon, _ in positions]
    lats = [lat for _, lat in positions]
    if min(lons) < -180 or max(lons) > 180 or min(lats) < -90 or max(lats) > 90:
        return None
    return min(lons), max(lons), min(lats), max(lats)


def _timestamp(value):
    timestamp = pd.to_datetime(value, utc=True, errors="coerce", format="ISO8601")
    # DatasetSchema's datetime64[ns] ends at 1677-2262; one record starts in
    # 1534, which would fail the whole run's validation.
    try:
        return timestamp.as_unit("ns")
    except OutOfBoundsDatetime:
        return pd.NaT


def build_dataset_row(record, bbox):
    west, east, south, north = bbox
    temporal = (record.get("temporal-extent") or [{}])[0]
    vertical = (record.get("vertical-extent") or [{}])[0]
    depths = [d for d in (_number(vertical.get("min")), _number(vertical.get("max"))) if d is not None]
    titles = record_titles(record)
    return {
        "title": titles["title"] or record.get("title"),
        "title_fr": titles["title_fr"],
        "erddap_url": CKAN_SOURCE_URL,
        "dataset_id": record["id"],
        "ckan_id": record["id"],
        # Required non-null; 'Other' is ERDDAP's own "none of the types" value.
        "cdm_data_type": "Other",
        "platform": "unknown",
        "platform_category": "unknown",
        "eovs": sorted(set(filter(None, record.get("eov") or []))),
        "organizations": record_organizations(record),
        "n_profiles": 0,
        "profile_variables": [],
        "source_type": "ckan",
        "obis_nodes": [],
        "content_hash": f"{CATALOGUE_VERSION}:{record.get('metadata_modified')}",
        "coverage_lon_min": west,
        "coverage_lon_max": east,
        "coverage_lat_min": south,
        "coverage_lat_max": north,
        "coverage_time_min": _timestamp(temporal.get("begin")),
        "coverage_time_max": _timestamp(temporal.get("end")),
        "coverage_depth_min": min(depths) if depths else None,
        "coverage_depth_max": max(depths) if depths else None,
        "metadata": from_ckan(record),
    }


def catalogue_result(records, cited, stored_hashes, run_id, skip_unchanged):
    now = datetime.now(UTC)
    datasets, skipped, attempts, verified = [], [], [], []

    def attempt(record_id, status, reason_code=None):
        attempts.append({
            "run_id": run_id,
            "erddap_url": CKAN_SOURCE_URL,
            "dataset_id": record_id,
            "source": "ckan",
            "status": status,
            "reason_code": reason_code,
            "attempted_at": now,
        })

    for record in records:
        if record.get("resource-type", "dataset") != "dataset" or record["id"] in cited:
            continue
        bbox = _bbox(record)
        if bbox is None:
            skipped.append([CKAN_SOURCE_URL, record["id"], NO_SPATIAL_EXTENT])
            attempt(record["id"], "skipped", NO_SPATIAL_EXTENT)
            continue
        row = build_dataset_row(record, bbox)
        if skip_unchanged and stored_hashes.get(record["id"]) == row["content_hash"]:
            verified.append({"erddap_url": CKAN_SOURCE_URL, "dataset_id": record["id"],
                             "verified_at": now})
            attempt(record["id"], "skipped", UNCHANGED)
            continue
        datasets.append({**row, "last_updated_at": now, "verified_at": now})
        attempt(record["id"], "success")

    def frame(rows, schema):
        columns = list(schema.to_schema().columns.keys())
        df = pd.DataFrame(rows)
        return df.reindex(columns=[*columns, *(c for c in df.columns if c not in columns)])

    return HarvestResult(
        profiles=pd.DataFrame(),
        datasets=frame(datasets, DatasetSchema),
        variables=pd.DataFrame(),
        skipped=pd.DataFrame(skipped, columns=list(SkippedDatasetSchema.to_schema().columns.keys())),
        attempts=frame(attempts, HarvestAttemptSchema),
        verified=frame(verified, VerifiedDatasetSchema),
    )


@task(task_run_name="harvest-ckan-catalogue")
def harvest_ckan_catalogue(run_id=None, cache=False, skip_unchanged=False):
    """A CKAN outage fails the task, so nothing is pruned."""
    prefect_logger = run_logger(logger)
    records = list_ckan_records(cache, query="*:*")
    cited, stored_hashes = load_catalogue_state(CKAN_SOURCE_URL)
    result = catalogue_result(records, cited, stored_hashes, run_id, skip_unchanged)
    prefect_logger.info(
        "CKAN catalogue: %d records, %d cited by harvested datasets, %d to load, "
        "%d unchanged, %d without a spatial extent",
        len(records), len(cited), len(result.datasets), len(result.verified),
        len(result.skipped),
    )
    return result
