import gzip
import json
import logging
import os
import time

import pandas as pd
import requests

from cde_harvester.base_harvester import BaseHarvester, HarvestResult
from cde_harvester.ckan.create_ckan_obis_link import get_ckan_obis_records
from cde_harvester.schemas import (
    DatasetSchema,
    ProfileSchema,
    SkippedDatasetSchema,
    VariableSchema,
)

logger = logging.getLogger(__name__)

OBIS_SOURCE_URL = "https://obis.org"


class OBISHarvester(BaseHarvester):
    """Harvester for OBIS datasets.

    Fetches occurrence records from the OBIS API and aggregates them
    by unique lat/lon per dataset into profile rows compatible with
    the existing CDE schema.
    """

    def __init__(self, limit_dataset_ids=None, folder="./obis"):
        self.limit_dataset_ids = limit_dataset_ids or []
        self.folder = folder

    def harvest(self) -> HarvestResult:
        all_profiles = []
        all_datasets = []
        all_skipped = []

        for dataset_id in self.limit_dataset_ids:
            logger.info("Processing OBIS dataset: %s", dataset_id)
            try:
                occurrences = self.get_occurrences(dataset_id)
                results = occurrences.get("results", [])

                if not results:
                    logger.warning("No occurrences for dataset %s", dataset_id)
                    all_skipped.append([OBIS_SOURCE_URL, dataset_id, "NO_OCCURRENCES"])
                    continue

                profiles = self.aggregate_profiles(dataset_id, results)
                if profiles.empty:
                    all_skipped.append([OBIS_SOURCE_URL, dataset_id, "NO_VALID_COORDINATES"])
                    continue

                dataset_row = self.build_dataset_row(dataset_id, results, profiles)

                all_profiles.append(profiles)
                all_datasets.append(dataset_row)

            except Exception as e:
                logger.error("Error processing OBIS dataset %s: %s", dataset_id, e, exc_info=True)
                all_skipped.append([OBIS_SOURCE_URL, dataset_id, "UNKNOWN_ERROR"])

        # Build result DataFrames
        df_profiles = (
            pd.concat(all_profiles, ignore_index=True) if all_profiles
            else pd.DataFrame(columns=ProfileSchema.to_schema().columns.keys())
        )
        df_datasets = (
            pd.concat(all_datasets, ignore_index=True) if all_datasets
            else pd.DataFrame(columns=DatasetSchema.to_schema().columns.keys())
        )
        skipped_columns = list(SkippedDatasetSchema.to_schema().columns.keys())
        df_skipped = (
            pd.DataFrame(all_skipped, columns=skipped_columns) if all_skipped
            else pd.DataFrame(columns=skipped_columns)
        )
        df_variables = pd.DataFrame(columns=VariableSchema.to_schema().columns.keys())

        # Enrich datasets with CKAN metadata (EOVs, French titles, CKAN IDs)
        if not df_datasets.empty:
            df_datasets = self._enrich_with_ckan(df_datasets)

        return HarvestResult(
            profiles=df_profiles,
            datasets=df_datasets,
            variables=df_variables,
            skipped=df_skipped,
        )

    def _enrich_with_ckan(self, df_datasets):
        """Join CKAN metadata onto datasets for EOVs, French titles, and CKAN IDs."""
        logger.info("Fetching CKAN metadata for %d OBIS datasets", len(df_datasets))
        df_ckan = get_ckan_obis_records(df_datasets["dataset_id"].tolist())

        if df_ckan.empty:
            df_datasets["title_fr"] = None
            df_datasets["ckan_id"] = None
            return df_datasets

        df_datasets = df_datasets.merge(df_ckan, on="dataset_id", how="left")

        # Use CKAN EOVs where available, keep empty list as fallback
        df_datasets["eovs"] = df_datasets.apply(
            lambda r: r["ckan_eovs"] if isinstance(r.get("ckan_eovs"), list) and r["ckan_eovs"] else r["eovs"],
            axis=1,
        )
        # Use CKAN title if available, keep OBIS title as fallback
        df_datasets["title"] = df_datasets["ckan_title"].fillna(df_datasets["title"])

        df_datasets.drop(columns=["ckan_eovs", "ckan_title"], inplace=True)

        return df_datasets

    def aggregate_profiles(self, dataset_id, results):
        """Aggregate occurrences by unique lat/lon into profile rows."""
        df = pd.DataFrame(results)

        # Filter records missing coordinates
        df = df.dropna(subset=["decimalLatitude", "decimalLongitude"])
        if df.empty:
            return df

        # Drop coordinates outside Web Mercator range (EPSG:3857 limit ~±85.06°)
        n_before = len(df)
        df = df[
            (df["decimalLatitude"].abs() <= 85.06) &
            (df["decimalLongitude"].abs() <= 180)
        ]
        dropped = n_before - len(df)
        if dropped:
            logger.warning("Dropped %d occurrences with out-of-range coordinates for %s", dropped, dataset_id)
        if df.empty:
            return df

        # Parse dates from OBIS unix timestamps (milliseconds)
        for col in ["date_start", "date_end"]:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], unit="ms", errors="coerce", utc=True)

        # Ensure optional columns exist (not all OBIS datasets have them)
        for col in ["date_start", "date_end", "minimumDepthInMeters", "maximumDepthInMeters"]:
            if col not in df.columns:
                df[col] = None

        # Round coordinates to avoid near-duplicate locations
        df["lat_round"] = df["decimalLatitude"].round(4)
        df["lon_round"] = df["decimalLongitude"].round(4)

        group_cols = ["lat_round", "lon_round"]
        grouped = df.groupby(group_cols)

        profiles = grouped.agg(
            latitude=("decimalLatitude", "first"),
            longitude=("decimalLongitude", "first"),
            depth_min=("minimumDepthInMeters", "min"),
            depth_max=("maximumDepthInMeters", "max"),
            time_min=("date_start", "min"),
            time_max=("date_end", "max"),
            n_records=("decimalLatitude", "count"),
        ).reset_index(drop=True)

        profiles["erddap_url"] = OBIS_SOURCE_URL
        profiles["dataset_id"] = dataset_id
        profiles["timeseries_id"] = ""
        profiles["profile_id"] = ""
        profiles["n_profiles"] = None

        # Compute records_per_day
        profiles["time_min"] = pd.to_datetime(profiles["time_min"], errors="coerce", utc=True)
        profiles["time_max"] = pd.to_datetime(profiles["time_max"], errors="coerce", utc=True)
        days = (profiles["time_max"] - profiles["time_min"]).dt.days
        days = days.replace(0, 1)
        profiles["records_per_day"] = profiles["n_records"] / days

        # Fill missing depths
        profiles["depth_min"] = profiles["depth_min"].fillna(0)
        profiles["depth_max"] = profiles["depth_max"].fillna(0)

        return profiles

    def build_dataset_row(self, dataset_id, results, profiles):
        """Build a single-row dataset DataFrame from OBIS dataset metadata."""
        metadata = self.fetch_dataset_metadata(dataset_id)

        institutes = metadata.get("institutes") or []
        organizations = [inst.get("name") for inst in institutes if inst.get("name")]

        dataset_row = pd.DataFrame([{
            "title": metadata.get("title", ""),
            "erddap_url": OBIS_SOURCE_URL,
            "dataset_id": dataset_id,
            "cdm_data_type": "Point",
            "platform": "unknown",
            "eovs": [],
            "organizations": organizations,
            "n_profiles": len(profiles),
            "profile_variables": [],
            "timeseries_id_variable": None,
            "profile_id_variable": None,
            "trajectory_id_variable": None,
            "num_columns": None,
            "first_eov_column": None,
            "source_type": "obis",
        }])
        return dataset_row

    def _read_cache(self, path):
        """Read a JSON cache file, supporting both plain and gzip-compressed."""
        gz_path = path + ".gz"
        if os.path.isfile(gz_path):
            with gzip.open(gz_path, "rt") as f:
                return json.load(f)
        if os.path.isfile(path):
            with open(path, "r") as f:
                return json.load(f)
        return None

    def _write_cache(self, path, data):
        """Write data to a gzip-compressed JSON cache file."""
        gz_path = path + ".gz"
        with gzip.open(gz_path, "wt") as f:
            json.dump(data, f)

    def fetch_dataset_metadata(self, dataset_id):
        """Fetch dataset metadata from the OBIS dataset API."""
        cache_file = os.path.join(self.folder, f"{dataset_id}_metadata.json")

        cached = self._read_cache(cache_file)
        if cached is not None:
            return cached

        url = f"https://api.obis.org/v3/dataset/{dataset_id}"
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])
            metadata = results[0] if results else {}
        except Exception as e:
            logger.warning("Failed to fetch metadata for %s: %s", dataset_id, e)
            metadata = {}

        self._write_cache(cache_file, metadata)
        return metadata

    def get_occurrences(self, dataset_id):
        """Fetch occurrences for a dataset, using cached JSON if available."""
        os.makedirs(self.folder, exist_ok=True)
        cache_file = os.path.join(self.folder, f"{dataset_id}.json")

        cached = self._read_cache(cache_file)
        if cached is not None:
            logger.info("Loaded %s occurrences from cache", dataset_id)
            return cached

        base_url = f"https://api.obis.org/v3/occurrence?datasetid={dataset_id}&size=10000"
        all_results = []
        url = base_url
        page = 1

        while True:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            page_data = response.json()
            results = page_data.get("results", [])

            if not results:
                break

            all_results.extend(results)
            total = page_data.get("total", 0)
            logger.info("  Page %d: %d/%d records", page, len(all_results), total)

            if len(results) < 10000:
                break

            last_id = results[-1].get("id")
            if not last_id:
                break
            url = f"{base_url}&after={last_id}"
            page += 1
            time.sleep(0.1)

        occurrences_data = {"results": all_results, "total": len(all_results)}
        logger.info("Loaded %d occurrences from OBIS for %s", len(all_results), dataset_id)

        self._write_cache(cache_file, occurrences_data)
        return occurrences_data


def harvest_obis(limit_dataset_ids=None, folder="./obis/"):
    """Run the OBIS harvester."""
    harvester = OBISHarvester(limit_dataset_ids, folder)
    return harvester.harvest()
