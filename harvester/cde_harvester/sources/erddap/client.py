#!/usr/bin/env python3

import hashlib
import io
import json
import logging
import re
import tempfile
import time
from urllib.parse import unquote, urlparse

import diskcache as dc
import pandas as pd
import requests
from prefect import get_run_logger, task
from prefect.cache_policies import NO_CACHE
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from cde_harvester.core.errors import (
    HASH_CROISSANT_HTTP_ERROR,
    HASH_CROISSANT_UNREADABLE,
    HASH_CROISSANT_UNSUPPORTED,
    HASH_FEDERATED_UNRESOLVED,
    HASH_NO_FILE_LIST,
    ResponseTooLargeError,
)
from cde_harvester.sources.erddap.dataset import Dataset

logging.getLogger("urllib3").setLevel(logging.WARNING)

# bytes
MAX_RESPONSE_SIZE = 2e8

# Bodies above this spill to disk, so a multi-hundred-MB orderByCount needn't fit in RAM.
SPOOL_MAX_IN_MEMORY = 8 * 1024 * 1024
DOWNLOAD_CHUNK_SIZE = 1024 * 1024

# pandas 2's datetime64[ns] range. pandas 3 parses beyond it, which would let
# typo years like 0019 through as real data; outside it counts as unparseable.
PLAUSIBLE_TIME_MIN = pd.Timestamp.min.tz_localize("UTC")
PLAUSIBLE_TIME_MAX = pd.Timestamp.max.tz_localize("UTC")

# Long enough for a re-run after an interrupted harvest, short enough that a
# changed dataset isn't re-harvested from stale responses for long.
CACHE_TTL_SECONDS = 12 * 3600

# Mixed into every Croissant hash: bump it when a harvester or schema change must
# reach every dataset, so the next run re-harvests instead of skipping as unchanged.
HARVEST_VERSION = 2


class _SpooledBody(tempfile.SpooledTemporaryFile):
    """Python 3.10's SpooledTemporaryFile lacks the readable/writable/seekable
    TextIOWrapper requires; 3.11 added them, so this can go once on 3.11+."""

    def readable(self):
        return True

    def writable(self):
        return True

    def seekable(self):
        return True

# 500 is retried even though some ERDDAPs use it for "no data" / "query too big":
# the body is still inspected once retries are exhausted. 413 comes from
# seagull-erddap's WAF on parallel requests; 408/520 are transient timeouts on
# cioosatlantic/cioospacific. 504 is deliberately absent: ERDDAP keeps compiling
# and caches the result, so the harvester retries at the end of the pass instead
# (see gateway_timeouts).
_RETRY_STATUSES = (408, 413, 500, 502, 503, 520, 522, 524)


_ERDDAP_SOURCE_RE = re.compile(
    r"(https?://.+?/erddap)/(tabledap|griddap)/([^/?.\s]+)"
)


# ERDDAP added the .croissant endpoint in 2.28.
CROISSANT_MIN_VERSION = (2, 28)

_ERDDAP_VERSION_RE = re.compile(r"ERDDAP_version=(\d+)\.(\d+)")


def _croissant_source_url(doc):
    match = re.search(r"sourceUrl=(\S+)", doc.get("description") or "")
    return match.group(1) if match else None


def _parse_erddap_source(source_url):
    """(erddap_base, dap, dataset_id) when source_url is another ERDDAP's data URL."""
    match = _ERDDAP_SOURCE_RE.match(source_url) if source_url else None
    return (match.group(1), match.group(2), match.group(3)) if match else None


def _build_retry_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=1.0,         # waits 0s, 2s, 4s between attempts
        status_forcelist=_RETRY_STATUSES,
        allowed_methods=frozenset(["GET", "HEAD"]),
        raise_on_status=False,      # let the existing 5xx-handling logic run
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class ERDDAP:
    def __init__(self, erddap_url, cache_requests=False):
        super().__init__()
        self.cache_requests = cache_requests

        if cache_requests:
            self.cache = dc.Cache("harvester_cache", size_limit=10000000000)
            print("Cache stats:")
            print("eviction_policy", self.cache.eviction_policy)
            print("count", self.cache.count)
            print("volume()", self.cache.volume())
            print("size_limit", self.cache.size_limit)

        self.domain = urlparse(erddap_url).netloc
        self.host_slug = self.domain.lower().replace(".", "-")  # for the task run label
        self.session = _build_retry_session()
        # {dataset_id: monotonic time of its first 504}; the harvester defers
        # these datasets to a second pass.
        self.gateway_timeouts = {}
        # {erddap_base: bool}; federated hops can land on other servers.
        self._croissant_supported = {}

        try:
            self.logger = get_run_logger()
        except Exception:
            self.logger = logging.getLogger(self.__class__.__name__)
        self.df_all_datasets = None
        logger = self.logger

        erddap_url = erddap_url.rstrip("/")
        self.url = erddap_url
        if not re.search("^https?://", erddap_url):
            raise RuntimeError(f"URL Must start wih http or https: {erddap_url}")

        if not erddap_url.endswith("/erddap"):
            logger.warning("URL doesn't end in /erddap, trying anyway")

    @task(task_run_name="list-datasets-{self.host_slug}", cache_policy=NO_CACHE)
    def get_all_datasets(self, data_structures=("table",)):
        """Request the ERDDAP allDatasets list, one request per dataStructure."""
        try:
            self.logger.info("Fetching all datasets from ERDDAP server: %s", self.url)
            frames = []
            for structure in data_structures:
                frame = self.erddap_csv_to_df(
                    f'/tabledap/allDatasets.csv?&accessible="public"&dataStructure="{structure}"',
                    skiprows=[1, 2],
                    cache=False,
                )
                # Tag the requested structure ourselves — older ERDDAPs omit
                # the dataStructure column from the listing.
                if frame is not None and not frame.empty:
                    frame["dataStructure"] = structure
                    frames.append(frame)
            if not frames:
                return pd.DataFrame()
            df = frames[0] if len(frames) == 1 else pd.concat(frames, ignore_index=True)
            self.logger.info(f"Found {len(df)} datasets")
            return df
        except requests.exceptions.HTTPError:
            self.logger.error("ERDDAP query failed", exc_info=True)
            return pd.DataFrame()

    def parse_erddap_date(s):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes; always
        tz-aware UTC so bounds from different formats can be subtracted."""
        is_timestamp = s.startswith("1.") or s.startswith("-1.")

        if is_timestamp:
            ts = pd.to_datetime(float(s), unit="s", utc=True)
        else:
            ts = pd.to_datetime(s, errors="coerce", utc=True)
        return ts if PLAUSIBLE_TIME_MIN <= ts <= PLAUSIBLE_TIME_MAX else pd.NaT

    def parse_erddap_dates(series):
        """ERDDAP dates come either as timestamps or ISO 8601 datetimes"""
        time = str(series.tolist()[0]).strip()
        is_timestamp = time.startswith("1.") or time.startswith("-1.")

        if is_timestamp:
            parsed = pd.to_datetime(pd.to_numeric(series), unit="s", utc=True)
        else:
            parsed = pd.to_datetime(series, errors="coerce", utc=True, format="ISO8601")
        return parsed.where(parsed.between(PLAUSIBLE_TIME_MIN, PLAUSIBLE_TIME_MAX))

    def erddap_csv_to_df(self, url, skiprows=(1,), dataset=None, cache=True):
        """Errors raise up to the dataset loop, so the dataset gets skipped."""
        if dataset:
            logger = dataset.logger
            erddap_url = dataset.erddap_url

        else:
            logger = self.logger
            erddap_url = self.url

        url_combined = erddap_url + url

        decoded_url = unquote(url_combined)
        # Prefect's log viewer stops auto-linking at "(" and quotes; encode them
        # so the whole URL stays clickable.
        log_url = decoded_url.translate(
            str.maketrans({"(": "%28", ")": "%29", '"': "%22", " ": "%20"})
        )
        logger.info(f"Requesting: {log_url}")
        if dataset is not None:
            dataset.queried_urls.append(decoded_url)

        response, body = self._fetch(
            url_combined, decoded_url, logger, cache=cache and self.cache_requests
        )
        if response.status_code == 504 and dataset is not None:
            self.gateway_timeouts.setdefault(dataset.id, time.monotonic())

        try:
            original_hostname = urlparse(url_combined).hostname
            actual_hostname = urlparse(response.url).hostname

            # redirect due to EDDTableFromErddap
            if original_hostname != actual_hostname and dataset:
                logger.debug("Redirecting %s to %s", original_hostname, actual_hostname)
                dataset.erddap_url = response.url.split("/erddap")[0] + "/erddap"

            no_data = False
            # Newer erddaps respond with 404 for no data
            if response.status_code == 404:
                no_data = True
            elif (
                response.status_code == 500
                and "Query error: No operator found in constraint=&quot;orderByCount"
                in response.text
            ):
                logger.error("OrderByCount not available within this ERDDAP Version")
                no_data = True
            elif (
                # Older erddaps respond with 500 for no data
                response.status_code == 500
                and "Your query produced no matching results" in response.text
            ):
                no_data = True

            elif (
                response.status_code == 500
                and "You are requesting too much data." in response.text
            ):
                logger.error("Query too big for the server")
                no_data = True
            elif response.status_code != 200:
                response.raise_for_status()
            else:
                # Not encoding="unicode_escape": applied to raw bytes it turns
                # every UTF-8 accent into mojibake.
                text_body = io.TextIOWrapper(
                    body, encoding=response.encoding or "utf-8", errors="replace"
                )
                # skip units line
                return pd.read_csv(text_body, skiprows=skiprows)
            if no_data:
                logger.error("Empty response")
                return pd.DataFrame()
        finally:
            body.close()

    def _fetch(self, url_combined, decoded_url, logger, cache=False):
        """Return (response, body), body a seekable binary stream at 0.

        A 200 body is streamed and abandoned past MAX_RESPONSE_SIZE. Non-200
        bodies are read whole on purpose: they are small error pages the caller
        matches on .text. Only 200 bodies are cached, streamed to and from disk
        files so a cached response never has to fit in memory.
        """
        if cache:
            cached, meta = self.cache.get(url_combined, read=True, tag=True)
            if cached is not None:
                response = requests.Response()
                response.status_code = 200
                response.url, response.encoding = json.loads(meta)
                return response, cached

        response = self.session.get(url_combined, timeout=3600, stream=True)
        try:
            body = io.BytesIO(response.content) if response.status_code != 200 else self._spool(response, decoded_url)
        finally:
            response.close()

        if cache and response.status_code == 200:
            self.cache.set(
                url_combined, body, read=True, expire=CACHE_TTL_SECONDS,
                tag=json.dumps([response.url, response.encoding]),
            )
            body.seek(0)
        return response, body

    @staticmethod
    def _spool(response, decoded_url):
        spool = _SpooledBody(max_size=SPOOL_MAX_IN_MEMORY)
        total = 0
        try:
            for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                total += len(chunk)
                if total > MAX_RESPONSE_SIZE:
                    raise ResponseTooLargeError(
                        f"Response exceeds {MAX_RESPONSE_SIZE:.0f} bytes "
                        f"(aborted after {total}): {decoded_url}"
                    )
                spool.write(chunk)
        except BaseException:
            spool.close()
            raise
        spool.seek(0)
        return spool

    def get_croissant_fingerprint(self, erddap_base, dataset_id, _hops=0,
                                  dap="tabledap"):
        """Return (content_hash, has_files, reason) from the dataset's Croissant.

        The hash is a reliable change signal only when source files are listed,
        so database-backed datasets are never skipped. Federated datasets are
        followed to their origin (max 3 hops). Fail-open: (None, False, <HASH_*
        reason>) on any error.
        """
        erddap_base = erddap_base.rstrip("/")
        if not self._supports_croissant(erddap_base):
            return None, False, HASH_CROISSANT_UNSUPPORTED
        try:
            # Not the 1h data-query timeout: a hung endpoint would stall every dataset.
            response = self.session.get(
                f"{erddap_base}/{dap}/{dataset_id}.croissant", timeout=60
            )
            if response.status_code != 200:
                return None, False, HASH_CROISSANT_HTTP_ERROR
            doc = response.json()
        except Exception:
            self.logger.warning(
                "Could not read Croissant for %s", dataset_id, exc_info=True
            )
            return None, False, HASH_CROISSANT_UNREADABLE

        distribution = doc.get("distribution") or []
        if isinstance(distribution, dict):
            distribution = [distribution]
        if any(isinstance(d, dict) and d.get("@type") == "cr:FileObject"
               for d in distribution):
            canonical = json.dumps(doc, sort_keys=True, separators=(",", ":"))
            digest = hashlib.sha256(f"{HARVEST_VERSION}:{canonical}".encode()).hexdigest()
            return digest, True, None

        if _hops < 3:
            origin = _parse_erddap_source(_croissant_source_url(doc))
            if origin:
                return self.get_croissant_fingerprint(
                    origin[0], origin[2], _hops + 1, dap=origin[1]
                )
            return None, False, HASH_NO_FILE_LIST

        return None, False, HASH_FEDERATED_UNRESOLVED

    def _supports_croissant(self, erddap_base):
        """False only when the server reports a version older than 2.28; an
        unreadable version stays fail-open and lets .croissant be tried."""
        if erddap_base not in self._croissant_supported:
            try:
                response = self.session.get(f"{erddap_base}/version", timeout=60)
                match = _ERDDAP_VERSION_RE.search(response.text)
            except requests.RequestException:
                match = None
            self._croissant_supported[erddap_base] = (
                not match
                or tuple(map(int, match.groups())) >= CROISSANT_MIN_VERSION
            )
        return self._croissant_supported[erddap_base]

    def get_dataset(self, dataset_id, data_structure="table"):
        return Dataset(self, dataset_id, data_structure=data_structure)

    def get_logger(self):
        logger = logging.getLogger(self.domain)
        return logger
