import gzip
import json
import logging
import os
import time

import pandas as pd
import requests
from prefect import task
from prefect.logging import get_run_logger

from cde_harvester.base_harvester import BaseHarvester, HarvestResult
from cde_harvester.ckan.create_ckan_obis_link import get_ckan_obis_records
from cde_harvester.schemas import (
    DatasetSchema,
    ObisCellSchema,
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

    MAX_RETRIES = 5

    def __init__(self, limit_dataset_ids=None, folder="./obis", prefect_logger=None):
        self.limit_dataset_ids = limit_dataset_ids or []
        self.folder = folder
        self.logger = prefect_logger or logger

    def harvest(self) -> HarvestResult:
        all_cells = []
        all_datasets = []
        all_skipped = []

        total = len(self.limit_dataset_ids)
        for i, dataset_id in enumerate(self.limit_dataset_ids, 1):
            self.logger.info("Processing OBIS dataset %d/%d: %s", i, total, dataset_id)
            last_error = None
            for attempt in range(1, self.MAX_RETRIES + 1):
                try:
                    occurrences = self.get_occurrences(dataset_id)
                    results = occurrences.get("results", [])

                    if not results:
                        self.logger.warning("No occurrences for dataset %s", dataset_id)
                        all_skipped.append([OBIS_SOURCE_URL, dataset_id, "NO_OCCURRENCES"])
                        break

                    cells = self.aggregate_cells(dataset_id, results)
                    if cells.empty:
                        all_skipped.append([OBIS_SOURCE_URL, dataset_id, "NO_VALID_COORDINATES"])
                        break

                    dataset_row = self.build_dataset_row(dataset_id, results, cells)

                    all_cells.append(cells)
                    all_datasets.append(dataset_row)
                    break

                except Exception as e:
                    last_error = e
                    self.logger.error(
                        "Error processing OBIS dataset %s (attempt %d/%d): %s",
                        dataset_id, attempt, self.MAX_RETRIES, e, exc_info=True,
                    )
                    if attempt < self.MAX_RETRIES:
                        self._clear_cache(dataset_id)
            else:
                self.logger.error("All %d attempts failed for OBIS dataset %s: %s", self.MAX_RETRIES, dataset_id, last_error)
                all_skipped.append([OBIS_SOURCE_URL, dataset_id, "UNKNOWN_ERROR"])

        # Build result DataFrames
        df_obis_cells = (
            pd.concat(all_cells, ignore_index=True) if all_cells
            else pd.DataFrame(columns=ObisCellSchema.to_schema().columns.keys())
        )
        df_profiles = pd.DataFrame(columns=ProfileSchema.to_schema().columns.keys())
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
            obis_cells=df_obis_cells,
        )

    def _enrich_with_ckan(self, df_datasets):
        """Join CKAN metadata onto datasets for EOVs, French titles, and CKAN IDs."""
        self.logger.info("Fetching CKAN metadata for %d OBIS datasets", len(df_datasets))
        df_ckan = get_ckan_obis_records(df_datasets["dataset_id"].tolist(), cache_folder=self.folder)

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

    def aggregate_cells(self, dataset_id, results):
        """Aggregate occurrences by unique lat/lon grid cell into obis_cells rows."""
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
            self.logger.warning("Dropped %d occurrences with out-of-range coordinates for %s", dropped, dataset_id)
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

        # Snap coordinates to a ~5 nautical mile grid (1/12 degree)
        # Round to 8 decimal places to avoid floating-point artifacts from the
        # multiply-back step (e.g. 550 * (1/12) can differ in the last bit
        # across rows, causing duplicate-key violations on insert).
        GRID_DEG = 1 / 12
        df["lat_grid"] = ((df["decimalLatitude"] / GRID_DEG).round() * GRID_DEG).round(8)
        df["lon_grid"] = ((df["decimalLongitude"] / GRID_DEG).round() * GRID_DEG).round(8)

        # Ensure scientificName column exists
        if "scientificName" not in df.columns:
            df["scientificName"] = None

        group_cols = ["lat_grid", "lon_grid"]
        grouped = df.groupby(group_cols)

        cells = grouped.agg(
            latitude=("lat_grid", "first"),
            longitude=("lon_grid", "first"),
            depth_min=("minimumDepthInMeters", "min"),
            depth_max=("maximumDepthInMeters", "max"),
            time_min=("date_start", "min"),
            time_max=("date_end", "max"),
            n_records=("decimalLatitude", "count"),
            scientific_names=("scientificName", lambda x: sorted(x.dropna().unique().tolist())),
        ).reset_index(drop=True)

        cells["dataset_id"] = dataset_id

        cells["time_min"] = pd.to_datetime(cells["time_min"], errors="coerce", utc=True)
        cells["time_max"] = pd.to_datetime(cells["time_max"], errors="coerce", utc=True)

        # Fill missing depths
        cells["depth_min"] = cells["depth_min"].fillna(0)
        cells["depth_max"] = cells["depth_max"].fillna(0)

        return cells

    def build_dataset_row(self, dataset_id, results, cells):
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
            "n_profiles": len(cells),
            "profile_variables": [],
            "timeseries_id_variable": None,
            "profile_id_variable": None,
            "trajectory_id_variable": None,
            "num_columns": None,
            "first_eov_column": None,
            "source_type": "obis",
        }])
        return dataset_row

    def _clear_cache(self, dataset_id):
        """Delete cached occurrence and metadata files for a dataset."""
        for name in [f"{dataset_id}.json", f"{dataset_id}_metadata.json"]:
            for path in [
                os.path.join(self.folder, name),
                os.path.join(self.folder, name + ".gz"),
            ]:
                if os.path.isfile(path):
                    os.remove(path)
                    self.logger.info("Cleared cache file: %s", path)

    def _read_cache(self, path):
        """Read a JSON cache file, supporting both plain and gzip-compressed."""
        gz_path = path + ".gz"
        try:
            if os.path.isfile(gz_path):
                with gzip.open(gz_path, "rt") as f:
                    return json.load(f)
            if os.path.isfile(path):
                with open(path, "r") as f:
                    return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            self.logger.warning("Corrupt cache file %s, will re-fetch: %s", path, e)
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
            self.logger.warning("Failed to fetch metadata for %s: %s", dataset_id, e)
            metadata = {}

        self._write_cache(cache_file, metadata)
        return metadata

    def get_occurrences(self, dataset_id):
        """Fetch occurrences for a dataset via OBIS S3 parquet, with REST API fallback."""
        os.makedirs(self.folder, exist_ok=True)
        cache_file = os.path.join(self.folder, f"{dataset_id}.json")

        cached = self._read_cache(cache_file)
        if cached is not None:
            self.logger.info("Loaded %s occurrences from cache", dataset_id)
            return cached

        import duckdb
        url = f"https://obis-open-data.s3.amazonaws.com/occurrence/{dataset_id}.parquet"
        query = f"""
            SELECT
                interpreted.decimalLatitude    AS decimalLatitude,
                interpreted.decimalLongitude   AS decimalLongitude,
                interpreted.date_start         AS date_start,
                interpreted.date_end           AS date_end,
                interpreted.minimumDepthInMeters AS minimumDepthInMeters,
                interpreted.maximumDepthInMeters AS maximumDepthInMeters,
                interpreted.scientificName     AS scientificName,
                _id                            AS id
            FROM read_parquet('{url}')
            WHERE interpreted.decimalLatitude  BETWEEN -85.06 AND 85.06
              AND interpreted.decimalLongitude BETWEEN -180   AND 180
        """
        try:
            df = duckdb.sql(query).df()
            results = [
                {k: None if v is pd.NA else v for k, v in row.items()}
                for row in df.to_dict(orient="records")
            ]
            occurrences_data = {"results": results, "total": len(results)}
            self.logger.info("Loaded %d occurrences from parquet for %s", len(results), dataset_id)
            self._write_cache(cache_file, occurrences_data)
            return occurrences_data
        except Exception as e:
            self.logger.warning("Parquet fetch failed for %s, falling back to API: %s", dataset_id, e)
            return self._get_occurrences_api(dataset_id)

    def _get_occurrences_api(self, dataset_id):
        """Fetch occurrences from the OBIS REST API (fallback)."""
        os.makedirs(self.folder, exist_ok=True)
        cache_file = os.path.join(self.folder, f"{dataset_id}.json")
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
            self.logger.info("  Page %d: %d/%d records", page, len(all_results), total)

            if len(results) < 10000:
                break

            last_id = results[-1].get("id")
            if not last_id:
                break
            url = f"{base_url}&after={last_id}"
            page += 1
            time.sleep(0.1)

        occurrences_data = {"results": all_results, "total": len(all_results)}
        self.logger.info("Loaded %d occurrences from OBIS for %s", len(all_results), dataset_id)

        self._write_cache(cache_file, occurrences_data)
        return occurrences_data


@task(task_run_name="harvest-obis")
def harvest_obis(limit_dataset_ids=None, folder="./obis/"):
    """Run the OBIS harvester."""
    harvester = OBISHarvester(limit_dataset_ids, folder, prefect_logger=get_run_logger())
    return harvester.harvest()
