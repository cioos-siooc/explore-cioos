import gzip
import itertools
import json
import logging
import os
import shutil
import tempfile
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import pandas as pd
import requests
from cde_harvester.core.day_sets import days_to_ranges
from cde_harvester.core.frame_spill import SpillSet
from cde_harvester.core.harvest_warnings import OCCURRENCES_DROPPED, HarvestWarnings
from cde_harvester.core.obis_cells import merge_cell_partials
from cde_harvester.core.observability import run_logger
from cde_harvester.core.record_metadata import from_cioos_record
from cde_harvester.core.schemas import (
    DatasetSchema,
    HarvestAttemptSchema,
    ObisCellSchema,
    ProfileSchema,
    SkippedDatasetSchema,
    VariableSchema,
)
from cde_harvester.sources.base import BaseHarvester, HarvestResult
from cde_harvester.sources.ckan.create_ckan_erddap_link import with_owner
from cde_harvester.sources.ckan.create_ckan_obis_link import get_ckan_obis_records
from cde_harvester.sources.obis.discovery import ObisDatasetDiscovery
from cde_harvester.sources.obis.geo_filter import ObisGeoFilter
from cioos_metadata_conversion.load_from import obis as obis_conversion
from cioos_metadata_conversion.load_from.obis import map_obis_to_cioos
from prefect import task

logger = logging.getLogger(__name__)

OBIS_SOURCE_URL = "https://obis.org"
OBIS_PARQUET_URL = "https://obis-open-data.s3.amazonaws.com/occurrence/{dataset_id}.parquet"

# Bounds the per-occurrence dicts `to_dict` builds (540 bytes/row, ~1.1 GiB on
# the largest OBIS dataset if all live at once).
OCCURRENCE_CACHE_SLICE_ROWS = 100_000

# duckdb vectors of 2048 rows (~205k rows) held at once; makes peak memory a
# function of chunk size (a full run OOM-killed a 6GB container). Smaller chunks
# cost CPU: each pays a full groupby and its partial cells pile up until merge.
FETCH_VECTORS_PER_CHUNK = 100

# Left to itself duckdb takes 80% of host RAM, no limit at all in a 6GB container.
OBIS_DUCKDB_MEMORY_LIMIT = os.environ.get("OBIS_DUCKDB_MEMORY_LIMIT", "512MB")

# The conversion scan's peak grows with threads and memory_limit doesn't bound
# it (CPR's eMoF: 1.56 GB at 24 threads, 0.9 GB at 8); a low memory_limit makes
# the converter fall back to sampling the API, which silently drops EOVs.
OBIS_CONVERSION_DUCKDB_THREADS = int(
    os.environ.get("OBIS_CONVERSION_DUCKDB_THREADS", min(os.cpu_count() or 1, 8))
)


# Epoch-ms range datetime64[ns] can represent; OBIS has real records like
# 200-10-02 and 1626-01-01.
_REPRESENTABLE_MS = (
    pd.Timestamp.min.value // 1_000_000 + 1,
    pd.Timestamp.max.value // 1_000_000 - 1,
)


def _epoch_ms_to_utc(series):
    """Out-of-range values become NaT.

    Masked BEFORE `to_datetime`: `errors="coerce"` raises OutOfBoundsDatetime
    for the nullable Int64 dtype, which duckdb picks for any chunk holding a NULL.
    """
    values = pd.to_numeric(series, errors="coerce")
    low, high = _REPRESENTABLE_MS
    # float64: pandas 2.3's to_datetime cache maps an Int64 <NA> to a bogus
    # negative index ("'indices' contains values less than allowed"); epoch ms
    # of real dates are exact in float64 and NaN parses cleanly.
    values = values.where((values >= low) & (values <= high)).astype("float64")
    return pd.to_datetime(values, unit="ms", errors="coerce", utc=True)


class _OccurrenceCacheWriter:
    """Streams occurrence frames into one {"results": [...], "total": n} gzip
    JSON file, byte-identical to a single-shot dump.

    Any exception discards. Writes a temp file and renames on commit: a
    truncated .gz raises EOFError, which is not an OSError and escapes the
    handler in `_read_cache`.
    """

    def __init__(self, path):
        self.gz_path = path + ".gz"
        self.tmp_path = f"{self.gz_path}.{os.getpid()}.tmp"
        self._file = None
        self.rows_written = 0

    def __enter__(self):
        os.makedirs(os.path.dirname(self.gz_path) or ".", exist_ok=True)
        self._file = gzip.open(self.tmp_path, "wt")
        self._file.write('{"results": [')
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self._file.write(f'], "total": {self.rows_written}}}')
        finally:
            self._file.close()
        if exc_type is None:
            os.replace(self.tmp_path, self.gz_path)
        elif os.path.isfile(self.tmp_path):
            os.remove(self.tmp_path)
        return False

    def write(self, df):
        for row in df.to_dict(orient="records"):
            if self.rows_written:
                # json.dump's own default item separator, so the bytes match a
                # single-shot dump exactly.
                self._file.write(", ")
            json.dump({k: None if v is pd.NA else v for k, v in row.items()}, self._file)
            self.rows_written += 1


_OCCURRENCE_CACHE_PREFIX = '{"results": ['
_OCCURRENCE_CACHE_READ_CHARS = 1 << 20


def _iter_occurrence_cache(path, slice_rows=OCCURRENCE_CACHE_SLICE_ROWS):
    """Reads what _OccurrenceCacheWriter wrote, one slice at a time: json.load of
    the largest cache (472 MB gzip) OOM-killed a 6GB worker.

    Raises ValueError (JSONDecodeError included), EOFError or OSError on a
    malformed or truncated file.
    """
    decoder = json.JSONDecoder()
    opener = gzip.open if path.endswith(".gz") else open
    rows = []
    with opener(path, "rt") as f:
        if f.read(len(_OCCURRENCE_CACHE_PREFIX)) != _OCCURRENCE_CACHE_PREFIX:
            raise ValueError(f"{path} does not start with {_OCCURRENCE_CACHE_PREFIX!r}")
        buf, pos, eof = "", 0, False
        while True:
            while True:
                while pos < len(buf) and buf[pos] in ", \t\r\n":
                    pos += 1
                if pos < len(buf) or eof:
                    break
                buf, pos = f.read(_OCCURRENCE_CACHE_READ_CHARS), 0
                eof = not buf
            if pos >= len(buf):
                raise ValueError(f"{path} ends before its results list closes")
            if buf[pos] == "]":
                break
            try:
                row, pos = decoder.raw_decode(buf, pos)
            except json.JSONDecodeError:
                if eof:
                    raise
                # The row straddles the buffer's end.
                more = f.read(_OCCURRENCE_CACHE_READ_CHARS)
                buf, pos, eof = buf[pos:] + more, 0, not more
                continue
            rows.append(row)
            if len(rows) == slice_rows:
                yield pd.DataFrame(rows)
                rows = []
    if rows:
        yield pd.DataFrame(rows)


class OBISHarvester(BaseHarvester):
    MAX_RETRIES = 5

    # Datasets' obis_cells held before spilling to disk (core.frame_spill.SpillSet):
    # holding all ~1000 OOM-killed a 6GB container at 296/971.
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
            # Empty frames would let the db-loader prune every OBIS dataset.
            raise ValueError(
                "OBISHarvester was given no dataset ids. Configure obis_discovery, "
                "obis_dataset_ids, or obis_datasets_file."
            )

        all_datasets = []
        all_skipped = []
        all_attempts = []
        spills = SpillSet(flush_every=self.CELLS_FLUSH_EVERY, prefix="obis_cells_")

        def record_attempt(dataset_id, status, reason_code=None,
                           error_message=None, duration_ms=None, warnings=None):
            query_urls = [
                f"https://api.obis.org/v3/dataset/{dataset_id}",
                OBIS_PARQUET_URL.format(dataset_id=dataset_id),
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
                "attempted_at": datetime.now(UTC),
                "query_urls": "\n".join(query_urls),
                "warnings": warnings.to_json() if warnings else None,
            })

        with spills:
            spills.register("cells", ObisCellSchema.to_schema().columns.keys())
            total = len(self.limit_dataset_ids)
            for i, dataset_id in enumerate(self.limit_dataset_ids, 1):
                self.logger.info("Processing OBIS dataset %d/%d: %s", i, total, dataset_id)
                last_error = None
                t0 = time.monotonic()
                self._expire_stale_cache(dataset_id)
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

                        # Every aggregation is associative, so merging per-chunk
                        # partials equals one pass (see core.obis_cells).
                        stats = {"n_occurrences": 0, "n_dropped": 0, "n_kept": 0}
                        warnings = HarvestWarnings(self.logger)
                        partials = []
                        for chunk in self.iter_occurrences(dataset_id, bbox=bbox):
                            partial = self._aggregate_chunk(
                                dataset_id, chunk, apply_filter=not exempt, stats=stats,
                            )
                            del chunk
                            if not partial.empty:
                                partials.append(partial)
                        self._log_aggregate_stats(dataset_id, stats, warnings)

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
                                warnings=warnings,
                            )
                            break

                        dataset_row = self.build_dataset_row(dataset_id, metadata, cells)

                        spills.append("cells", cells)
                        all_datasets.append(dataset_row)
                        record_attempt(
                            dataset_id, status="success",
                            duration_ms=int((time.monotonic() - t0) * 1000),
                            warnings=warnings,
                        )
                        break

                    except Exception as e:
                        # Not kept as the exception: its traceback would pin the
                        # occurrence frame alive through the NEXT fetch.
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

            if not df_datasets.empty:
                df_datasets = self._enrich_with_ckan(df_datasets)
                df_datasets = self._enrich_with_conversion(df_datasets)

            return HarvestResult(
                profiles=df_profiles,
                datasets=df_datasets,
                variables=df_variables,
                skipped=df_skipped,
                obis_cells=df_obis_cells,
                attempts=df_attempts,
            )

    def _enrich_with_ckan(self, df_datasets):
        self.logger.info("Fetching CKAN metadata for %d OBIS datasets", len(df_datasets))
        ipt_urls = {
            dataset_id: self.fetch_dataset_metadata(dataset_id).get("url")
            for dataset_id in df_datasets["dataset_id"]
        }
        df_ckan = get_ckan_obis_records(ipt_urls, erddap_url=OBIS_SOURCE_URL)

        if df_ckan.empty:
            df_datasets["title_fr"] = None
            df_datasets["ckan_id"] = None
            df_datasets["metadata"] = None
            return df_datasets

        df_datasets = df_datasets.merge(df_ckan, on="dataset_id", how="left")

        df_datasets["eovs"] = df_datasets.apply(
            lambda r: r["ckan_eovs"] if isinstance(r.get("ckan_eovs"), list) and r["ckan_eovs"] else r["eovs"],
            axis=1,
        )
        df_datasets["organizations"] = df_datasets.apply(
            lambda r: with_owner(
                r["ckan_organizations"]
                if isinstance(r.get("ckan_organizations"), list) and r["ckan_organizations"]
                else r["organizations"],
                r.get("ckan_owner"),
            ),
            axis=1,
        )
        df_datasets["title"] = df_datasets["ckan_title"].fillna(df_datasets["title"])

        df_datasets.drop(columns=["ckan_eovs", "ckan_organizations", "ckan_owner", "ckan_title"], inplace=True)
        df_datasets.rename(columns={"ckan_metadata": "metadata"}, inplace=True)

        return df_datasets

    def _enrich_with_conversion(self, df_datasets):
        df_datasets["summary"] = None
        unmatched = df_datasets.index[df_datasets["ckan_id"].isna()]
        total = len(unmatched)
        converted = 0
        for i, idx in enumerate(unmatched, 1):
            if i % 50 == 0 or i == total:
                self.logger.info("Metadata conversion progress: %d/%d", i, total)
            record = self.convert_metadata(df_datasets.at[idx, "dataset_id"])
            if record:
                df_datasets.at[idx, "eovs"] = record["eov"]
                df_datasets.at[idx, "summary"] = record["abstract"]["en"] or None
                df_datasets.at[idx, "metadata"] = from_cioos_record(
                    record,
                    citation=self.fetch_dataset_metadata(df_datasets.at[idx, "dataset_id"]).get("citation"),
                )
                converted += 1
        self.logger.info(
            "Converted OBIS metadata for %d / %d datasets without a CKAN record", converted, total,
        )
        return df_datasets

    def convert_metadata(self, dataset_id):
        cache_file = os.path.join(self.folder, f"{dataset_id}_cioos.json")
        cached = self._read_cache(cache_file)
        if cached is not None:
            return cached

        metadata = self.fetch_dataset_metadata(dataset_id)
        if not metadata:
            return None

        import duckdb

        # The converter's module-global connection is never closed and ratchets
        # 1.4 GB to 6 GB over a full run; use a fresh one per dataset.
        con = duckdb.connect(config={"threads": OBIS_CONVERSION_DUCKDB_THREADS})
        obis_conversion._DUCKDB_CON = con
        try:
            con.execute("INSTALL httpfs; LOAD httpfs;")
            record = map_obis_to_cioos(metadata)
        except Exception as e:
            self.logger.warning("Metadata conversion failed for %s: %s", dataset_id, e)
            return None
        finally:
            obis_conversion._DUCKDB_CON = None
            con.close()

        self._write_cache(cache_file, record)
        return record

    def aggregate_cells(self, dataset_id, results, apply_filter=False):
        """Single-pass entry point; chunked callers must `_aggregate_chunk` each
        chunk, merge, then `_finalize_cells` ONCE."""
        return self._finalize_cells(
            self._aggregate_chunk(dataset_id, results, apply_filter=apply_filter)
        )

    def _finalize_cells(self, cells):
        """Non-associative steps, once at the end: a per-chunk fillna(0) would
        merge as min(0.0, 15.0) = 0.0."""
        if cells.empty:
            return cells
        cells["depth_min"] = cells["depth_min"].fillna(0)
        cells["depth_max"] = cells["depth_max"].fillna(0)
        return cells

    def _log_aggregate_stats(self, dataset_id, stats, warnings):
        """Once per dataset: per-chunk logging would ship tens of thousands of
        lines to the Prefect API."""
        if stats.get("n_dropped"):
            warnings.add(
                OCCURRENCES_DROPPED,
                f"{stats['n_dropped']} of {stats['n_occurrences']} occurrences "
                "dropped: coordinates outside the Web Mercator range "
                "(|latitude| > 85.06 or |longitude| > 180)",
                count=stats["n_dropped"],
            )
        if stats.get("n_filtered") is not None:
            self.logger.info(
                "Geo filter kept %d/%d occurrences for %s",
                stats["n_kept"], stats["n_filtered"], dataset_id,
            )

    def _aggregate_chunk(self, dataset_id, results, apply_filter=False, stats=None):
        """Partial obis_cells rows; every aggregation is associative except
        `days`, which the combiner recomputes from the merged `day_ranges`."""
        df = pd.DataFrame(results)
        if stats is not None:
            stats["n_occurrences"] = stats.get("n_occurrences", 0) + len(df)

        # An empty REST page has no columns, so the dropna would raise KeyError.
        if df.empty:
            return df

        df = df.dropna(subset=["decimalLatitude", "decimalLongitude"])
        if df.empty:
            return df

        # EPSG:3857 limit
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

        for col in ["date_start", "date_end"]:
            if col in df.columns:
                df[col] = _epoch_ms_to_utc(df[col])

        for col in ["date_start", "date_end", "minimumDepthInMeters", "maximumDepthInMeters"]:
            if col not in df.columns:
                df[col] = None

        # date_start only: OBIS bounds a coarse eventDate ("1997") as a whole
        # year, and expanding the range would over-count days.
        day_source = df["date_start"]
        if not pd.api.types.is_datetime64_any_dtype(day_source):
            day_source = pd.to_datetime(day_source, errors="coerce", utc=True, format="ISO8601")
        df["day"] = day_source.dt.floor("D")

        # ~5 nmi grid; round(8) because the multiply-back can differ in the last
        # bit across rows, causing duplicate-key violations on insert.
        GRID_DEG = 1 / 12
        df["lat_grid"] = ((df["decimalLatitude"] / GRID_DEG).round() * GRID_DEG).round(8)
        df["lon_grid"] = ((df["decimalLongitude"] / GRID_DEG).round() * GRID_DEG).round(8)

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
            # The map UNIONS these across a hex's cells, so it needs WHICH days.
            day_ranges=("day", days_to_ranges),
            scientific_names=("scientificName", lambda x: sorted(x.dropna().unique().tolist())),
        ).reset_index(drop=True)

        cells["dataset_id"] = dataset_id

        # Not in _finalize_cells: duckdb's dtype varies per chunk (int64 vs
        # Int64), so partials must be uniform before they meet.
        cells["time_min"] = pd.to_datetime(cells["time_min"], errors="coerce", utc=True, format="ISO8601")
        cells["time_max"] = pd.to_datetime(cells["time_max"], errors="coerce", utc=True, format="ISO8601")

        return cells

    def build_dataset_row(self, dataset_id, metadata, cells):
        institutes = metadata.get("institutes") or []
        organizations = [inst.get("name") for inst in institutes if inst.get("name")]
        nodes = metadata.get("nodes") or []
        obis_nodes = [n.get("name") for n in nodes if n.get("name")]

        dataset_row = pd.DataFrame([{
            # cde.datasets.title is NOT NULL; a failed metadata fetch gives {}.
            "title": metadata.get("title") or dataset_id,
            "erddap_url": OBIS_SOURCE_URL,
            "dataset_id": dataset_id,
            "cdm_data_type": "Point",
            "platform": "unknown",
            "platform_category": "unknown",
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

    def _cache_files(self, dataset_id):
        return [
            path
            for name in [f"{dataset_id}.json", f"{dataset_id}_metadata.json", f"{dataset_id}_cioos.json"]
            for path in [os.path.join(self.folder, name), os.path.join(self.folder, name + ".gz")]
            if os.path.isfile(path)
        ]

    def _clear_cache(self, dataset_id):
        for path in self._cache_files(dataset_id):
            os.remove(path)
            self.logger.info("Cleared cache file: %s", path)

    def _expire_stale_cache(self, dataset_id):
        """Clears the dataset's cache when OBIS rewrote its parquet export after
        the oldest cache file was written, i.e. the dataset was re-ingested.

        Datasets without a parquet export (REST-only) keep their cache.
        """
        cache_files = self._cache_files(dataset_id)
        if not cache_files:
            return
        try:
            response = requests.head(OBIS_PARQUET_URL.format(dataset_id=dataset_id), timeout=30)
            response.raise_for_status()
            published = parsedate_to_datetime(response.headers["Last-Modified"]).timestamp()
        except (requests.RequestException, KeyError, TypeError, ValueError) as e:
            self.logger.info("Keeping %s cache, parquet freshness unknown: %s", dataset_id, e)
            return
        if published > min(os.path.getmtime(path) for path in cache_files):
            self.logger.info("OBIS republished %s since it was cached, re-fetching", dataset_id)
            self._clear_cache(dataset_id)

    def _read_cache(self, path):
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
        gz_path = path + ".gz"
        # Some callers run before any os.makedirs(self.folder), and the
        # obis_cache mount can be absent in flow-run containers.
        os.makedirs(os.path.dirname(gz_path) or ".", exist_ok=True)
        with gzip.open(gz_path, "wt") as f:
            json.dump(data, f)

    def _write_occurrence_cache(self, path, df, slice_rows=OCCURRENCE_CACHE_SLICE_ROWS):
        with _OccurrenceCacheWriter(path) as writer:
            for start in range(0, len(df), slice_rows):
                writer.write(df.iloc[start:start + slice_rows])

    def fetch_dataset_metadata(self, dataset_id):
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
        """Yield a dataset's occurrences as DataFrame chunks, from the cache, the
        OBIS S3 parquet, or the REST API (the largest dataset is 2.1M rows).

        ``bbox`` is the geo filter's polygon bounds: a superset pre-filter that
        only stops the parquet reader materializing out-of-region rows.
        """
        os.makedirs(self.folder, exist_ok=True)
        cache_file = os.path.join(self.folder, f"{dataset_id}.json")

        for path in (cache_file + ".gz", cache_file):
            if not os.path.isfile(path):
                continue
            self.logger.info("Loaded %s occurrences from cache", dataset_id)
            yielded_any = False
            try:
                for chunk in _iter_occurrence_cache(path, OCCURRENCE_CACHE_SLICE_ROWS):
                    yielded_any = True
                    yield chunk
                return
            except (ValueError, EOFError, OSError) as e:
                self.logger.warning("Corrupt cache file %s, will re-fetch: %s", path, e)
                os.remove(path)
                if yielded_any:
                    # Same rule as the parquet stream below: the retry loop redoes the dataset.
                    raise

        import duckdb
        url = OBIS_PARQUET_URL.format(dataset_id=dataset_id)

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
        # Not duckdb.sql()'s implicit global connection: never closed, and its
        # memory limit defaults to 80% of host RAM.
        spill_dir = tempfile.mkdtemp(prefix="obis_parquet_", dir=self.folder)
        con = duckdb.connect(config={
            "memory_limit": OBIS_DUCKDB_MEMORY_LIMIT,
            "temp_directory": spill_dir,
        })
        yielded_any = False
        try:
            # Chunking the REMOTE file directly is 8.8x slower: fetch_df_chunk
            # pulls in lock-step with the consumer, serializing the S3 reads.
            local_parquet = os.path.join(spill_dir, "occurrences.parquet")
            con.execute(
                f"COPY ({query}) TO '{local_parquet}' (FORMAT PARQUET, COMPRESSION zstd)"
            )
            con.execute(f"SELECT * FROM read_parquet('{local_parquet}')")
            with _OccurrenceCacheWriter(cache_file) as writer:
                while True:
                    chunk = con.fetch_df_chunk(FETCH_VECTORS_PER_CHUNK)
                    if chunk.empty:
                        break
                    writer.write(chunk)
                    yielded_any = True
                    yield chunk
                    del chunk
                self.logger.info(
                    "Loaded %d occurrences from parquet for %s", writer.rows_written, dataset_id,
                )
        except Exception as e:
            if yielded_any:
                # Falling back to the API now would double-count; the harvest's
                # retry loop redoes the dataset from scratch instead.
                raise
            self.logger.warning("Parquet fetch failed for %s, falling back to API: %s", dataset_id, e)
            yield from self._iter_occurrences_api(dataset_id)
        finally:
            con.close()
            shutil.rmtree(spill_dir, ignore_errors=True)

    def _iter_occurrences_api(self, dataset_id):
        pages = self._paginate_occurrences_api(dataset_id)
        first = next(pages, None)
        if first is None:
            # No cache, so the next run retries rather than trusting an empty one.
            return

        cache_file = os.path.join(self.folder, f"{dataset_id}.json")
        with _OccurrenceCacheWriter(cache_file) as writer:
            for page in itertools.chain([first], pages):
                df = pd.DataFrame(page)
                del page
                writer.write(df)
                yield df
                del df
            self.logger.info(
                "Loaded %d occurrences from OBIS for %s", writer.rows_written, dataset_id,
            )

    def _paginate_occurrences_api(self, dataset_id):
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

    Without explicit ``limit_dataset_ids``, the dataset list comes from
    discovery; its failures fail the task so nothing is pruned.
    """
    # run_logger(): callable outside a flow context.
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
