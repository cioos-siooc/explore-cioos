import gzip
import json
import logging
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone

import pandas as pd
import requests
from cde_harvester.core.day_sets import days_to_ranges
from cde_harvester.core.frame_spill import SpillSet
from cde_harvester.core.obis_cells import merge_cell_partials
from cde_harvester.core.observability import run_logger
from cde_harvester.core.schemas import (
    DatasetSchema,
    HarvestAttemptSchema,
    ObisCellSchema,
    ProfileSchema,
    SkippedDatasetSchema,
    VariableSchema,
)
from cde_harvester.sources.base import BaseHarvester, HarvestResult
from cde_harvester.sources.ckan.create_ckan_obis_link import get_ckan_obis_records
from cde_harvester.sources.obis.discovery import ObisDatasetDiscovery
from cde_harvester.sources.obis.geo_filter import ObisGeoFilter
from prefect import task

logger = logging.getLogger(__name__)

OBIS_SOURCE_URL = "https://obis.org"

# Rows per slice when serializing an occurrence frame to the JSON cache. Bounds
# the dicts `to_dict` builds, which are otherwise one per occurrence, all live
# at once (540 bytes/row measured, ~1.1 GiB on the largest OBIS dataset).
OCCURRENCE_CACHE_SLICE_ROWS = 100_000

# How much of a dataset to hold in memory at once, as duckdb vectors of 2048
# rows (~205k rows). This is what makes peak memory a function of the chunk
# size rather than of the dataset size: the largest OBIS dataset is 2.1M
# occurrences, and a full run OOM-killed a 6GB container. Smaller chunks bound
# memory further but cost CPU -- each one pays a full groupby, and the partial
# cells they produce accumulate until the dataset is merged, which is not free
# on the datasets that drive peak (p99 is 7,783 cells per dataset, max 25,009).
FETCH_VECTORS_PER_CHUNK = 100

# Ceiling for duckdb's own buffer pool while streaming one dataset's parquet.
# Left to itself duckdb takes 80% of host RAM, which inside a 6GB container is
# not a limit at all; this keeps its share well clear of the harvester's.
OBIS_DUCKDB_MEMORY_LIMIT = os.environ.get("OBIS_DUCKDB_MEMORY_LIMIT", "512MB")


# The epoch-millisecond range datetime64[ns] can represent (1677-09-21 to
# 2262-04-11). OBIS carries dates well outside it -- fossil and historical
# records like 200-10-02 and 1626-01-01 are real in the corpus.
_REPRESENTABLE_MS = (
    pd.Timestamp.min.value // 1_000_000 + 1,
    pd.Timestamp.max.value // 1_000_000 - 1,
)


def _epoch_ms_to_utc(series):
    """Parse OBIS epoch-millisecond dates, out-of-range values becoming NaT.

    The out-of-range mask is applied BEFORE `to_datetime` because
    `errors="coerce"` does not actually hold for the nullable Int64 dtype in
    pandas 1.5.3 -- it raises OutOfBoundsDatetime from astype_overflowsafe
    instead of coercing (int64, float64 and object all coerce correctly). That
    matters here because duckdb picks the pandas dtype per chunk from whether
    that chunk contained a NULL, so the same column arrives as int64 or Int64
    depending on the data, and only the Int64 case raises.
    """
    values = pd.to_numeric(series, errors="coerce")
    low, high = _REPRESENTABLE_MS
    values = values.where((values >= low) & (values <= high))
    return pd.to_datetime(values, unit="ms", errors="coerce", utc=True)


class _OccurrenceCacheWriter:
    """Streams occurrence frames into one {"results": [...], "total": n} gzip
    JSON file -- the format the cache has always used, so files written before
    and after this are byte-identical and interchangeable.

    Incremental because the chunked fetch has no whole frame to serialize, and
    because serializing one costs a dict per occurrence (540 bytes/row
    measured, ~1.1 GiB on the largest dataset) all live at once.

    Writes to a temp file and renames on commit: a crash mid-write otherwise
    leaves a truncated .gz that the next run reads as a real cache, because
    gzip raises EOFError on a short read and EOFError is not an OSError, so it
    escapes the handler in `_read_cache`.
    """

    def __init__(self, path):
        self.gz_path = path + ".gz"
        self.tmp_path = f"{self.gz_path}.{os.getpid()}.tmp"
        os.makedirs(os.path.dirname(self.gz_path) or ".", exist_ok=True)
        self._file = gzip.open(self.tmp_path, "wt")
        self._file.write('{"results": [')
        self.rows_written = 0

    def write(self, df):
        for row in df.to_dict(orient="records"):
            if self.rows_written:
                # json.dump's own default item separator, so the bytes match a
                # single-shot dump exactly.
                self._file.write(", ")
            # json cannot serialize pd.NA, which duckdb produces for a null in
            # a nullable-dtype column.
            json.dump({k: None if v is pd.NA else v for k, v in row.items()}, self._file)
            self.rows_written += 1

    def commit(self):
        self._file.write(f'], "total": {self.rows_written}}}')
        self._file.close()
        os.replace(self.tmp_path, self.gz_path)

    def abort(self):
        self._file.close()
        if os.path.isfile(self.tmp_path):
            os.remove(self.tmp_path)


class OBISHarvester(BaseHarvester):
    """Harvester for OBIS datasets.

    Fetches occurrence records from the OBIS API and aggregates them
    by unique lat/lon per dataset into profile rows compatible with
    the existing CDE schema.
    """

    MAX_RETRIES = 5

    # How many datasets' obis_cells to hold before spilling them to disk (see
    # core.frame_spill.SpillSet, which owns the mechanism and the full
    # rationale). A full discovery run is ~1000 datasets and OOM-killed a 6GB
    # container at 296/971 when they were all held in one list; the duckdb
    # allocator arenas on this path make it worse than most.
    CELLS_FLUSH_EVERY = 50

    def __init__(self, limit_dataset_ids=None, folder="./obis", prefect_logger=None,
                 geo_filter=None, run_id=None):
        self.limit_dataset_ids = limit_dataset_ids or []
        self.folder = folder
        self.logger = prefect_logger or logger
        self.geo_filter = geo_filter or ObisGeoFilter(mode="canada")
        self.run_id = run_id

    def harvest(self) -> HarvestResult:
        if not self.limit_dataset_ids:
            # Returning empty frames here would look like "OBIS has no data" and
            # let the db-loader prune every OBIS dataset out of the database.
            raise ValueError(
                "OBISHarvester was given no dataset ids. Configure obis_discovery, "
                "obis_dataset_ids, or obis_datasets_file."
            )

        all_datasets = []
        all_skipped = []
        all_attempts = []
        spills = SpillSet(flush_every=self.CELLS_FLUSH_EVERY, prefix="obis_cells_")

        def record_attempt(dataset_id, status, reason_code=None,
                           error_message=None, duration_ms=None):
            # Surface the two OBIS endpoints we hit so the dashboard can show
            # exactly what was fetched per dataset.
            query_urls = [
                f"https://api.obis.org/v3/dataset/{dataset_id}",
                f"https://obis-open-data.s3.amazonaws.com/occurrence/{dataset_id}.parquet",
            ]
            all_attempts.append({
                "run_id": self.run_id,
                "erddap_url": OBIS_SOURCE_URL,
                "dataset_id": dataset_id,
                "source": "obis",
                "status": status,
                "reason_code": reason_code,
                "error_message": error_message,
                "duration_ms": duration_ms,
                "attempted_at": datetime.now(timezone.utc),
                "query_urls": "\n".join(query_urls),
            })

        with spills:
            spills.register("cells", ObisCellSchema.to_schema().columns.keys())
            total = len(self.limit_dataset_ids)
            for i, dataset_id in enumerate(self.limit_dataset_ids, 1):
                self.logger.info("Processing OBIS dataset %d/%d: %s", i, total, dataset_id)
                last_error = None
                t0 = time.monotonic()
                for attempt in range(1, self.MAX_RETRIES + 1):
                    try:
                        metadata = self.fetch_dataset_metadata(dataset_id)
                        exempt = self.geo_filter.is_exempt(metadata)

                        if not exempt:
                            hit = self.geo_filter.extent_intersects(metadata.get("extent"))
                            if hit is False:
                                self.logger.info(
                                    "Skipping %s: extent outside Canadian borders", dataset_id,
                                )
                                all_skipped.append([OBIS_SOURCE_URL, dataset_id, "OUT_OF_REGION"])
                                record_attempt(
                                    dataset_id, status="skipped",
                                    reason_code="OUT_OF_REGION",
                                    error_message="Dataset extent outside Canadian borders",
                                    duration_ms=int((time.monotonic() - t0) * 1000),
                                )
                                break

                        bbox = None if exempt else self.geo_filter.bounds()

                        # Aggregate chunk by chunk so no dataset is ever fully
                        # resident. The partial cells are tiny next to the
                        # occurrences that produce them (the largest dataset is
                        # 2.1M occurrences and 21.5k cells), and every
                        # aggregation involved is associative, so merging them
                        # gives exactly what one pass over the whole dataset
                        # would -- see core.obis_cells.
                        stats = {"n_occurrences": 0, "n_dropped": 0, "n_kept": 0}
                        partials = []
                        for chunk in self.iter_occurrences(dataset_id, bbox=bbox):
                            partial = self._aggregate_chunk(
                                dataset_id, chunk, apply_filter=not exempt, stats=stats,
                            )
                            del chunk
                            if not partial.empty:
                                partials.append(partial)
                        self._log_aggregate_stats(dataset_id, stats)

                        if not stats["n_occurrences"]:
                            self.logger.warning("No occurrences for dataset %s", dataset_id)
                            all_skipped.append([OBIS_SOURCE_URL, dataset_id, "NO_OCCURRENCES"])
                            record_attempt(
                                dataset_id, status="skipped",
                                reason_code="NO_OCCURRENCES",
                                error_message="OBIS returned no occurrence records",
                                duration_ms=int((time.monotonic() - t0) * 1000),
                            )
                            break

                        cells = self._finalize_cells(
                            merge_cell_partials(partials, dataset_id)
                        )
                        del partials
                        if cells.empty:
                            all_skipped.append([OBIS_SOURCE_URL, dataset_id, "NO_VALID_COORDINATES"])
                            record_attempt(
                                dataset_id, status="skipped",
                                reason_code="NO_VALID_COORDINATES",
                                error_message="No occurrences had valid lat/lon after filtering",
                                duration_ms=int((time.monotonic() - t0) * 1000),
                            )
                            break

                        dataset_row = self.build_dataset_row(dataset_id, metadata, cells)

                        spills.append("cells", cells)
                        all_datasets.append(dataset_row)
                        record_attempt(
                            dataset_id, status="success",
                            duration_ms=int((time.monotonic() - t0) * 1000),
                        )
                        break

                    except Exception as e:
                        # Formatted now rather than kept as the exception: an
                        # exception object holds its traceback, whose frames pin
                        # that attempt's occurrence frame alive through the NEXT
                        # dataset's fetch.
                        last_error = f"{type(e).__name__}: {e}"
                        self.logger.error(
                            "Error processing OBIS dataset %s (attempt %d/%d): %s",
                            dataset_id, attempt, self.MAX_RETRIES, e, exc_info=True,
                        )
                        if attempt < self.MAX_RETRIES:
                            self._clear_cache(dataset_id)
                else:
                    self.logger.error(
                        "All %d attempts failed for OBIS dataset %s: %s",
                        self.MAX_RETRIES,
                        dataset_id,
                        last_error,
                    )
                    all_skipped.append([OBIS_SOURCE_URL, dataset_id, "UNKNOWN_ERROR"])
                    record_attempt(
                        dataset_id, status="error",
                        reason_code="UNKNOWN_ERROR",
                        error_message=(
                            f"All {self.MAX_RETRIES} attempts failed: {last_error}"
                            if last_error else f"All {self.MAX_RETRIES} attempts failed"
                        ),
                        duration_ms=int((time.monotonic() - t0) * 1000),
                    )

                spills.checkpoint()

            # Build result DataFrames. collect() flushes the trailing partial
            # batch, so a run shorter than CELLS_FLUSH_EVERY still lands.
            df_obis_cells = spills.collect("cells")
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
            attempt_columns = list(HarvestAttemptSchema.to_schema().columns.keys())
            df_attempts = (
                pd.DataFrame(all_attempts) if all_attempts
                else pd.DataFrame(columns=attempt_columns)
            )

            # Enrich datasets with CKAN metadata (EOVs, French titles, CKAN IDs)
            if not df_datasets.empty:
                df_datasets = self._enrich_with_ckan(df_datasets)

            return HarvestResult(
                profiles=df_profiles,
                datasets=df_datasets,
                variables=df_variables,
                skipped=df_skipped,
                obis_cells=df_obis_cells,
                attempts=df_attempts,
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

    def aggregate_cells(self, dataset_id, results, apply_filter=False):
        """Aggregate occurrences by unique lat/lon grid cell into obis_cells rows.

        Single-pass entry point: aggregate everything, then finalize. Callers
        that feed occurrences in chunks must instead call `_aggregate_chunk`
        per chunk, merge the partials, and call `_finalize_cells` ONCE at the
        end -- see `_finalize_cells` for why that order is load-bearing.
        """
        return self._finalize_cells(
            self._aggregate_chunk(dataset_id, results, apply_filter=apply_filter)
        )

    def _finalize_cells(self, cells):
        """Apply the aggregations that are NOT associative, once, at the end.

        `fillna(0)` must not run per chunk. A cell whose depths are all null in
        one chunk would yield 0.0 there, and merging that with a real 15.0 from
        another chunk gives min(0.0, 15.0) = 0.0 -- silently wrong, and null
        depth is normal in OBIS. depth_max is wrong symmetrically wherever the
        real depth is negative (intertidal / above-datum records): max(0.0,
        -2.0) = 0.0 instead of -2.0.
        """
        if cells.empty:
            return cells
        cells["depth_min"] = cells["depth_min"].fillna(0)
        cells["depth_max"] = cells["depth_max"].fillna(0)
        return cells

    def _log_aggregate_stats(self, dataset_id, stats):
        """Report one chunked dataset's filtering totals in a single line each.

        `_aggregate_chunk` accumulates instead of logging because it runs per
        chunk: the largest dataset is ~11 chunks and a full run is ~900
        datasets, so logging in place would add tens of thousands of lines,
        each one shipped to the Prefect API from inside the container whose
        memory this is trying to bound.
        """
        if stats.get("n_dropped"):
            self.logger.warning(
                "Dropped %d occurrences with out-of-range coordinates for %s",
                stats["n_dropped"], dataset_id,
            )
        if stats.get("n_filtered") is not None:
            self.logger.info(
                "Geo filter kept %d/%d occurrences for %s",
                stats["n_kept"], stats["n_filtered"], dataset_id,
            )

    def _aggregate_chunk(self, dataset_id, results, apply_filter=False, stats=None):
        """Aggregate one chunk of occurrences into partial obis_cells rows.

        `stats`, when given, accumulates the filtering counts instead of
        logging them here -- see `_log_aggregate_stats`.

        Every aggregation here is associative and commutative, so partials from
        disjoint chunks can be merged and the result equals a single pass over
        the concatenation. `days` is the exception and is not carried directly:
        it is recomputed from the merged `day_ranges` by the combiner.
        """
        df = pd.DataFrame(results)
        if stats is not None:
            stats["n_occurrences"] = stats.get("n_occurrences", 0) + len(df)

        # A chunk with no rows at all carries no columns either, so the dropna
        # below would raise KeyError rather than return empty. duckdb's
        # end-of-stream frame does carry the columns, but an empty REST page or
        # a dataset with no occurrences arrives here as a bare empty list.
        if df.empty:
            return df

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
            if stats is None:
                self.logger.warning("Dropped %d occurrences with out-of-range coordinates for %s", dropped, dataset_id)
            else:
                stats["n_dropped"] = stats.get("n_dropped", 0) + dropped
        if df.empty:
            return df

        # Geographic filter: keep only occurrences inside the configured polygon.
        # Skipped for exempt datasets (OBIS Canada / OTN) and when the filter is off.
        if apply_filter:
            n_before = len(df)
            mask = self.geo_filter.filter_points(
                df["decimalLatitude"].to_numpy(),
                df["decimalLongitude"].to_numpy(),
            )
            df = df[mask]
            if stats is None:
                self.logger.info(
                    "Geo filter kept %d/%d occurrences for %s",
                    len(df), n_before, dataset_id,
                )
            else:
                stats["n_filtered"] = stats.get("n_filtered", 0) + n_before
                stats["n_kept"] = stats.get("n_kept", 0) + len(df)
            if df.empty:
                return df

        # Parse dates from OBIS unix timestamps (milliseconds)
        for col in ["date_start", "date_end"]:
            if col in df.columns:
                df[col] = _epoch_ms_to_utc(df[col])

        # Ensure optional columns exist (not all OBIS datasets have them)
        for col in ["date_start", "date_end", "minimumDepthInMeters", "maximumDepthInMeters"]:
            if col not in df.columns:
                df[col] = None

        # Distinct UTC days with data, the same unit cde.trajectory_hexes.days
        # carries. date_start, not the date_start..date_end range: OBIS bounds
        # a coarse eventDate ("1997") as a whole year, and expanding that would
        # rebuild the span defect this replaces (docs/trajectory-coverage.md).
        #
        # Reuses the conversion above when it already ran -- re-parsing an
        # already-datetime column costs an extra 8 bytes/row at peak (measured),
        # which is real on the multi-million-occurrence datasets discovery now
        # turns up. Only the never-had-the-column case pays for a parse, and
        # there the values are all None anyway.
        day_source = df["date_start"]
        if not pd.api.types.is_datetime64_any_dtype(day_source):
            day_source = pd.to_datetime(day_source, errors="coerce", utc=True)
        df["day"] = day_source.dt.floor("D")

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
            # nunique skips NaT, so undated occurrences contribute no days.
            days=("day", "nunique"),
            # The same day set as `days`, as maximal runs of consecutive days.
            # The map UNIONS these across the cells in a hex rather than adding
            # day counts up, so it needs to know WHICH days, not how many: two
            # cells reporting on the same day are one day of coverage.
            day_ranges=("day", days_to_ranges),
            scientific_names=("scientificName", lambda x: sorted(x.dropna().unique().tolist())),
        ).reset_index(drop=True)

        cells["dataset_id"] = dataset_id

        # Normalize here, not in _finalize_cells: duckdb's pandas dtype for a
        # chunk depends on whether that chunk happened to contain a NULL
        # (int64 vs Int64), so partials must be made uniform before they meet.
        cells["time_min"] = pd.to_datetime(cells["time_min"], errors="coerce", utc=True)
        cells["time_max"] = pd.to_datetime(cells["time_max"], errors="coerce", utc=True)

        return cells

    def build_dataset_row(self, dataset_id, metadata, cells):
        """Build a single-row dataset DataFrame from OBIS dataset metadata."""
        institutes = metadata.get("institutes") or []
        organizations = [inst.get("name") for inst in institutes if inst.get("name")]
        # OBIS regional/thematic nodes (EurOBIS, OBIS-USA, etc.). The metadata
        # is already fetched here for the EEZ-exemption check in
        # obis_geo_filter.py; reuse it for the user-facing nodes filter.
        nodes = metadata.get("nodes") or []
        obis_nodes = [n.get("name") for n in nodes if n.get("name")]

        dataset_row = pd.DataFrame([{
            # Fall back to dataset_id if OBIS metadata fetch returned no title
            # (empty dict from a transient error, missing field, etc.).
            # cde.datasets has NOT NULL on `title`; an empty string can also
            # cause issues downstream.
            "title": metadata.get("title") or dataset_id,
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
            "obis_nodes": obis_nodes,
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
                with open(path) as f:
                    return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            self.logger.warning("Corrupt cache file %s, will re-fetch: %s", path, e)
        return None

    def _write_cache(self, path, data):
        """Write data to a gzip-compressed JSON cache file."""
        gz_path = path + ".gz"
        # Some callers (e.g. fetch_dataset_metadata) run before any
        # os.makedirs(self.folder); in flow-run containers spawned by the
        # Prefect docker pool the obis_cache mount can be absent, so the
        # directory may not exist yet.
        os.makedirs(os.path.dirname(gz_path) or ".", exist_ok=True)
        with gzip.open(gz_path, "wt") as f:
            json.dump(data, f)

    def _write_occurrence_cache(self, path, df, slice_rows=OCCURRENCE_CACHE_SLICE_ROWS):
        """Write a whole occurrence frame to the cache, `slice_rows` at a time."""
        writer = _OccurrenceCacheWriter(path)
        try:
            for start in range(0, len(df), slice_rows):
                writer.write(df.iloc[start:start + slice_rows])
            writer.commit()
        except BaseException:
            writer.abort()
            raise

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

    def iter_occurrences(self, dataset_id, bbox=None):
        """Yield a dataset's occurrences as DataFrames, from the cache, the
        OBIS S3 parquet, or the REST API.

        Chunks rather than one frame: the largest OBIS dataset is 2.1M
        occurrences, and materializing a whole one is what made peak memory a
        function of dataset size. Every consumer aggregates chunk by chunk, so
        nothing downstream needs the whole thing either.

        Frames, not lists of dicts: `aggregate_cells` builds a frame from
        whatever it is handed, so the dicts existed only to be converted
        straight back, and they cost 896 of the 1108 bytes/row this path held
        at peak (measured: 1033 -> 112 MiB on the largest dataset). The pd.NA
        scrub they carried now happens only where it was ever needed, in the
        cache writer, because json cannot serialize pd.NA.

        ``bbox``, when given, is (lon_min, lat_min, lon_max, lat_max) -- the
        geo filter's polygon bounds. It's a superset pre-filter: points
        outside it are guaranteed to fail the polygon test that runs later in
        aggregate_cells, so applying it here changes nothing about which rows
        end up kept, it just stops the parquet reader materializing rows for
        clearly-out-of-region datasets (e.g. global occurrence dumps) before
        they're ever boxed into Python objects.
        """
        os.makedirs(self.folder, exist_ok=True)
        cache_file = os.path.join(self.folder, f"{dataset_id}.json")

        cached = self._read_cache(cache_file)
        if cached is not None:
            self.logger.info("Loaded %s occurrences from cache", dataset_id)
            # pop, not get: drops the dict's reference to the list so each
            # slice can be freed as the caller consumes it, rather than the
            # whole list staying alive alongside the frames built from it.
            # json.load itself is unavoidable here while the cache is one JSON
            # object -- it is the residual this chunking cannot reach.
            results = cached.pop("results", [])
            del cached
            for start in range(0, len(results), OCCURRENCE_CACHE_SLICE_ROWS):
                yield pd.DataFrame(results[start:start + OCCURRENCE_CACHE_SLICE_ROWS])
            return

        import duckdb
        url = f"https://obis-open-data.s3.amazonaws.com/occurrence/{dataset_id}.parquet"

        lat_min, lat_max = -85.06, 85.06
        lon_min, lon_max = -180, 180
        if bbox is not None:
            b_lon_min, b_lat_min, b_lon_max, b_lat_max = bbox
            lat_min, lat_max = max(lat_min, b_lat_min), min(lat_max, b_lat_max)
            lon_min, lon_max = max(lon_min, b_lon_min), min(lon_max, b_lon_max)

        query = f"""
            SELECT
                interpreted.decimalLatitude    AS decimalLatitude,
                interpreted.decimalLongitude   AS decimalLongitude,
                interpreted.date_start         AS date_start,
                interpreted.date_end           AS date_end,
                interpreted.minimumDepthInMeters AS minimumDepthInMeters,
                interpreted.maximumDepthInMeters AS maximumDepthInMeters,
                interpreted.scientificName     AS scientificName
            FROM read_parquet('{url}')
            WHERE interpreted.decimalLatitude  BETWEEN {lat_min} AND {lat_max}
              AND interpreted.decimalLongitude BETWEEN {lon_min} AND {lon_max}
        """
        # An explicit connection rather than duckdb.sql()'s implicit global one:
        # that global is never closed and never configured, so its buffer pool
        # keeps whatever it read for the life of the process and its memory
        # limit defaults to 80% of RAM (24.3 GiB on the machine this was
        # profiled on) -- which is not a limit at all inside a 6GB container.
        spill_dir = tempfile.mkdtemp(prefix="obis_parquet_", dir=self.folder)
        con = duckdb.connect(config={
            "memory_limit": OBIS_DUCKDB_MEMORY_LIMIT,
            # Spill duckdb's own intermediates here rather than growing the
            # heap past memory_limit.
            "temp_directory": spill_dir,
        })
        writer = None
        yielded_any = False
        try:
            # Land the remote parquet locally in ONE statement, then chunk the
            # local copy. Chunking the REMOTE file directly is 8.8x slower
            # (measured, 833k rows: 2.7s -> 23.7s): fetch_df_chunk pulls in
            # lock-step with the consumer, which serializes what duckdb would
            # otherwise read from S3 in parallel. The local file is transient,
            # deleted below, and tiny next to the JSON cache (1.9 MB vs 100 MB
            # for the same dataset) -- it is not a second cache.
            local_parquet = os.path.join(spill_dir, "occurrences.parquet")
            con.execute(
                f"COPY ({query}) TO '{local_parquet}' (FORMAT PARQUET, COMPRESSION zstd)"
            )
            relation = con.sql(f"SELECT * FROM read_parquet('{local_parquet}')")
            writer = _OccurrenceCacheWriter(cache_file)
            while True:
                chunk = relation.fetch_df_chunk(FETCH_VECTORS_PER_CHUNK)
                if chunk.empty:
                    break
                writer.write(chunk)
                yielded_any = True
                yield chunk
                del chunk
            self.logger.info(
                "Loaded %d occurrences from parquet for %s", writer.rows_written, dataset_id,
            )
            writer.commit()
            writer = None
        except Exception as e:
            if writer is not None:
                writer.abort()
                writer = None
            if yielded_any:
                # Past the first chunk the caller has already aggregated part
                # of this dataset, so re-reading it from the REST API would
                # double-count. Let the harvest's retry loop redo the dataset
                # from scratch instead -- it discards partial cells, because
                # they are only appended to the spill once a dataset finishes.
                raise
            self.logger.warning("Parquet fetch failed for %s, falling back to API: %s", dataset_id, e)
            yield from self._iter_occurrences_api(dataset_id)
        finally:
            if writer is not None:
                writer.abort()
            con.close()
            shutil.rmtree(spill_dir, ignore_errors=True)

    def _iter_occurrences_api(self, dataset_id):
        """Yield occurrences from the OBIS REST API (fallback), a page at a time."""
        writer = None
        try:
            for page in self._paginate_occurrences_api(dataset_id):
                if writer is None:
                    writer = _OccurrenceCacheWriter(
                        os.path.join(self.folder, f"{dataset_id}.json")
                    )
                df = pd.DataFrame(page)
                del page
                writer.write(df)
                yield df
                del df
            if writer is not None:
                self.logger.info(
                    "Loaded %d occurrences from OBIS for %s", writer.rows_written, dataset_id,
                )
                writer.commit()
                writer = None
        finally:
            if writer is not None:
                writer.abort()

    def _paginate_occurrences_api(self, dataset_id):
        """Yield pages of occurrence records from the OBIS REST API.

        A page at a time rather than accumulating every page into one list:
        that list was the same whole-dataset materialization the parquet path
        has stopped doing.
        """
        os.makedirs(self.folder, exist_ok=True)
        base_url = f"https://api.obis.org/v3/occurrence?datasetid={dataset_id}&size=10000"
        url = base_url
        page = 1
        seen = 0

        while True:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            page_data = response.json()
            results = page_data.get("results", [])

            if not results:
                break

            seen += len(results)
            total = page_data.get("total", 0)
            self.logger.info("  Page %d: %d/%d records", page, seen, total)
            last_id = results[-1].get("id")
            n_results = len(results)
            yield results
            del results

            if n_results < 10000 or not last_id:
                break

            url = f"{base_url}&after={last_id}"
            page += 1
            time.sleep(0.1)


@task(task_run_name="harvest-obis")
def harvest_obis(limit_dataset_ids=None, folder="./obis/", geo_filter=None, run_id=None,
                 discovery=None):
    """Run the OBIS harvester.

    When no explicit ``limit_dataset_ids`` are given and ``discovery`` is
    enabled, the dataset list is resolved from the OBIS API first. Discovery
    failures propagate: the task fails, so ``cde_pipeline`` never reaches the
    db-loader and nothing is pruned.
    """
    # run_logger() rather than get_run_logger() so the task body is callable
    # (and testable) outside a flow context.
    prefect_logger = run_logger(logger)
    geo_filter = geo_filter or ObisGeoFilter(mode="canada")

    if not limit_dataset_ids and discovery is not None and discovery.enabled:
        result = ObisDatasetDiscovery(
            discovery, geo_filter=geo_filter, logger=prefect_logger,
        ).discover()
        limit_dataset_ids = result.dataset_ids
        _publish_discovery_artifact(result, prefect_logger)
    elif limit_dataset_ids:
        prefect_logger.info(
            "Harvesting %d explicitly configured OBIS dataset(s); discovery bypassed",
            len(limit_dataset_ids),
        )

    harvester = OBISHarvester(
        limit_dataset_ids, folder,
        prefect_logger=prefect_logger,
        geo_filter=geo_filter,
        run_id=run_id,
    )
    return harvester.harvest()


def _publish_discovery_artifact(result, prefect_logger):
    """Best-effort Prefect artifact showing what discovery returned. Never fails the run."""
    try:
        from prefect.artifacts import create_table_artifact

        rows = [{"query": label, "datasets": count} for label, count in result.per_query.items()]
        rows.append({"query": "TOTAL (deduped)", "datasets": len(result.dataset_ids)})
        if result.geometry_bytes:
            rows.append({"query": "geometry WKT bytes", "datasets": result.geometry_bytes})
        create_table_artifact(
            key="obis-discovery",
            table=rows,
            description="OBIS datasets discovered for this harvest run.",
        )
    except Exception as e:
        prefect_logger.warning("Could not publish OBIS discovery artifact: %s", e)
