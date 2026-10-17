"""
download_erddap regroup a set of tool used by CDE to download ERDDAP datasets.
"""

import io
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote, urlparse

import pandas as pd
import requests
from erddapy import ERDDAP
from loguru import logger

from cioos_downloader.formats import (
    REQUEST_HEADERS,
    polygon_regions,
    query_box,
    write_obis,
    write_subset,
)
from cioos_downloader.source_metadata import save_source_metadata

ONE_MB = 10**6
DATASET_SIZE_LIMIT = 1000 * ONE_MB
QUERY_SIZE_LIMIT = 5000 * ONE_MB
CHUNK_SIZE = 1024**2
# (connect, read): a hung server becomes a FAILED subset instead of a stalled job.
REQUEST_TIMEOUT = (30, 600)
MAX_WORKERS = 6
MAX_REQUESTS_PER_SERVER = 2
# Feature-ID regexes are split so each URL stays under common proxy limits;
# past MAX_FEATURE_REQUESTS a bounding-box request is cheaper.
URL_BUDGET = 6000
MAX_FEATURE_REQUESTS = 8

DOWNLOADING = "DOWNLOADING"
COMPLETED = "COMPLETED"
PARTIAL = "PARTIAL"
FAILED = "FAILED"
EMPTY = "EMPTY"
IGNORED = "IGNORED"

HTTP_ERROR = "HTTP_ERROR"
UNKNOWN_ERROR = "UNKNOWN_ERROR"
DATASET_SIZE_LIMIT_HIT = "DATASET_SIZE_LIMIT"
QUERY_SIZE_LIMIT_HIT = "QUERY_SIZE_LIMIT"

OBIS_PARQUET_URL = "https://obis-open-data.s3.amazonaws.com/occurrence/{dataset_id}.parquet"


@dataclass(frozen=True)
class Format:
    key: str
    erddap_response: str
    mediatype: str
    # A truncated binary response is unreadable, so it can't ship as PARTIAL.
    binary: bool
    label: str


FORMATS = {
    f.key: f
    for f in (
        Format("csv", "csv", "text/csv", False, "CSV"),
        Format("parquet", "parquetWMeta", "application/vnd.apache.parquet", True, "Parquet"),
        Format("odv", "odvTxt", "text/tab-separated-values", False, "ODV spreadsheet"),
        Format("nccf", "ncCF", "application/x-netcdf", True, "NetCDF CF (DSG)"),
    )
}
DEFAULT_FORMAT = "csv"
# OBIS occurrences are a flat table: there is no ODV or CF-DSG rendition of it.
OBIS_FORMATS = ("csv", "parquet")


# ERDDAP error envelope: Error { code=500; message="Query error: ..."; }
_ERDDAP_MESSAGE_RE = re.compile(r'message\s*=\s*"(.*?)"\s*;?\s*\}?\s*$', re.DOTALL | re.IGNORECASE)
MAX_ERROR_CHARS = 500


def erddap_server_to_name(server):
    return urlparse(server).netloc.replace(".", "_")


def dataset_folder_name(dataset):
    return "{}_{}".format(dataset["dataset_id"], erddap_server_to_name(dataset["erddap_url"]))


def _now():
    return datetime.now(UTC).isoformat(timespec="seconds")


# Characters Java regex can't take as a one-character class ([.]), and the
# quote that would end ERDDAP's string; IDs containing them fall back to a box.
_UNSAFE_ID_CHARACTERS = set('\\"[]^')
_REGEX_SPECIAL = set(".$*+?(){}|&-")


def _regex_literal(value):
    return "".join(f"[{c}]" if c in _REGEX_SPECIAL else c for c in value)


def feature_constraints(dataset):
    """Constraints selecting exactly the features the map search matched,
    split to fit URL_BUDGET; None when a bounding box should be used."""
    variable = dataset.get("feature_id_variable")
    ids = [i for i in dataset.get("feature_ids") or [] if i]
    if not variable or not ids or any(_UNSAFE_ID_CHARACTERS & set(i) for i in ids):
        return None

    chunks, current = [], []
    for literal in map(_regex_literal, sorted(ids)):
        if current and len(quote("|".join([*current, literal]))) > URL_BUDGET:
            chunks.append(current)
            current = []
        current.append(literal)
    chunks.append(current)
    if len(chunks) > MAX_FEATURE_REQUESTS:
        return None
    return [{f"{variable}=~": "(" + "|".join(chunk) + ")"} for chunk in chunks]


def _day_bound(value, time_of_day):
    return value + time_of_day if len(value) == len("YYYY-MM-DD") else value


def get_erddap_download_url(dataset, user_query, variables, region=None, response="csv", extra=None):
    e = ERDDAP(server=dataset["erddap_url"], protocol="tabledap")
    e.response = response
    e.dataset_id = dataset["dataset_id"]
    # Without explicit variables an unconstrained URL is ".csv?", which ERDDAP
    # answers with a 302 to its HTML info page.
    if variables:
        e.variables = variables
    e.constraints = dict(extra or {})

    # The UI sends whole days; a bare date would end the range at its midnight.
    if user_query.get("time_min"):
        e.constraints["time>="] = _day_bound(user_query["time_min"], "T00:00:00Z")
    if user_query.get("time_max"):
        e.constraints["time<="] = _day_bound(user_query["time_max"], "T23:59:59Z")

    # Feature IDs already pin the selection in space.
    box = None if extra else query_box(user_query, region)
    if box:
        lon_min, lat_min, lon_max, lat_max = box
        e.constraints.update(
            {"latitude>=": lat_min, "latitude<=": lat_max, "longitude>=": lon_min, "longitude<=": lon_max}
        )

    if "depth" in variables:
        if user_query.get("depth_min"):
            e.constraints["depth>="] = user_query["depth_min"]
        if user_query.get("depth_max"):
            e.constraints["depth<="] = user_query["depth_max"]

    return e.get_download_url()


def _variables(dataset):
    if dataset.get("table_variables"):
        return [v["name"] for v in dataset["table_variables"]]
    info_url = ERDDAP(dataset["erddap_url"]).get_info_url(dataset["dataset_id"], response="csv")
    with requests.get(info_url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT) as response:
        response.raise_for_status()
        info = pd.read_csv(io.StringIO(response.text))
    return info.loc[info["Row Type"] == "variable", "Variable Name"].to_list()


def _server_error(response):
    """ERDDAP's error message, else the body's first line, without tags."""
    text = getattr(response, "text", None)
    if not isinstance(text, str) or not text.strip():
        return ""
    match = _ERDDAP_MESSAGE_RE.search(text.strip())
    if match:
        text = match.group(1)
    else:
        text = re.sub(r"<[^>]+>", " ", text.strip())
        text = next((line for line in text.splitlines() if line.strip()), "")
    return " ".join(text.split())[:MAX_ERROR_CHARS]


class _QueryBudget:
    def __init__(self, dataset_limit, query_limit):
        self._lock = threading.Lock()
        self.dataset_limit = dataset_limit
        self.query_limit = query_limit
        self.total = 0

    def add(self, size):
        with self._lock:
            self.total += size
            return self.total

    def exceeded(self):
        with self._lock:
            return self.total > self.query_limit


class _ServerSlots:
    def __init__(self):
        self._lock = threading.Lock()
        self._slots = {}

    def __call__(self, url):
        host = urlparse(url).netloc
        with self._lock:
            return self._slots.setdefault(host, threading.Semaphore(MAX_REQUESTS_PER_SERVER))


def _stream_to_file(url, path: Path, already_downloaded, limit):
    """Returns (bytes_written, error, empty, truncated)."""
    written = 0
    with requests.get(url, headers=REQUEST_HEADERS, stream=True, timeout=REQUEST_TIMEOUT) as response:
        if response.status_code != 200:
            server_error = _server_error(response)
            error = " ".join(filter(None, [f"HTTP {response.status_code}", response.reason]))
            error += f": {server_error}" if server_error else ""
            # ERDDAP also answers 404 for an unknown datasetID, which is a fault.
            empty = response.status_code == 404 and "no matching results" in server_error
            return 0, error, empty, False
        with open(path, "wb") as f:
            for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
                allowed = limit - already_downloaded - written
                f.write(chunk[:allowed])
                written += min(len(chunk), allowed)
                if len(chunk) > allowed:
                    return written, None, False, True
    return written, None, False, False


def _drop_partial_last_line(path: Path):
    data = path.read_bytes()
    path.write_bytes(data[: data.rfind(b"\n") + 1])


def _relative(files, root: Path):
    return [{**f, "path": f["path"].relative_to(root).as_posix(), "bytes": f["path"].stat().st_size} for f in files]


def _row(dataset, fmt, folder_name):
    return {
        "erddap_url": dataset["erddap_url"],
        "dataset_id": dataset["dataset_id"],
        "ckan_id": dataset.get("ckan_id"),
        "title": dataset.get("title"),
        "source_type": dataset.get("source_type") or "erddap",
        "cdm_data_type": dataset.get("cdm_data_type"),
        "folder": folder_name,
        "format": fmt,
        "download_url_list": [],
        "feature_constrained": False,
        "started_at": _now(),
        "finished_at": None,
        "status": DOWNLOADING,
        "reason_code": None,
        "erddap_error": "",
        "warnings": [],
        "files": [],
        "file_size": 0,
        "bytes_downloaded": 0,
        "n_records": 0,
        "dataset_limit_hit": False,
        "query_limit_hit": False,
    }


def _download_erddap(dataset, user_query, regions, fmt, row, folder: Path, budget):
    form = FORMATS[fmt]
    variables = _variables(dataset)
    constraints = feature_constraints(dataset)
    row["feature_constrained"] = constraints is not None
    requests_to_make = (
        [(None, c) for c in constraints] if constraints else [(r, None) for r in regions or [None]]
    )

    parts, errors = [], []
    for i, (region, extra) in enumerate(requests_to_make):
        url = get_erddap_download_url(dataset, user_query, variables, region, form.erddap_response, extra)
        row["download_url_list"].append(url)
        if budget.exceeded():
            row.update(status=IGNORED, reason_code=QUERY_SIZE_LIMIT_HIT, query_limit_hit=True)
            continue
        if row["dataset_limit_hit"]:
            continue

        logger.info("Download {}", url)
        part = folder / f".part{i}"
        written, error, empty, truncated = _stream_to_file(url, part, row["bytes_downloaded"], budget.dataset_limit)
        row["bytes_downloaded"] += written
        if error:
            errors.append(error)
            if not empty:
                row.update(status=FAILED, reason_code=HTTP_ERROR)
                logger.bind(erddap_url=dataset["erddap_url"], dataset_id=dataset["dataset_id"], download_url=url).error(
                    "ERDDAP downloader download error: {}", error
                )
            continue
        if truncated:
            row["dataset_limit_hit"] = True
            if form.binary:
                part.unlink()
                row.update(status=FAILED, reason_code=DATASET_SIZE_LIMIT_HIT)
                errors.append(
                    f"Over the {budget.dataset_limit // ONE_MB} MB per-dataset limit; "
                    "try a smaller selection or CSV."
                )
                continue
            _drop_partial_last_line(part)
            row.update(status=PARTIAL, reason_code=DATASET_SIZE_LIMIT_HIT)
        parts.append(part)

    if parts and row["status"] != FAILED:
        files = write_subset(fmt, parts, regions, folder / dataset_folder_name(dataset))
        row["files"] = _relative(files, folder.parent)
    for part in parts:
        part.unlink()

    row["erddap_error"] = "\n".join(errors)
    if row["status"] == DOWNLOADING:
        row["status"] = COMPLETED if row["files"] else EMPTY


def _download_obis(dataset, user_query, regions, fmt, row, folder: Path):
    dataset_id = dataset["dataset_id"]
    url = OBIS_PARQUET_URL.format(dataset_id=dataset_id)
    row["download_url_list"] = [url]

    files = write_obis(fmt, url, user_query, regions, folder / dataset_folder_name(dataset))
    row["files"] = _relative(files, folder.parent)
    row["status"] = COMPLETED if files else EMPTY


def download_dataset(dataset, user_query, regions, requested_format, root: Path, budget, slots):
    source_type = dataset.get("source_type") or "erddap"
    fmt = requested_format
    if source_type == "obis" and fmt not in OBIS_FORMATS:
        fmt = DEFAULT_FORMAT

    folder_name = dataset_folder_name(dataset)
    folder = root / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    row = _row(dataset, fmt, folder_name)
    row["format_fallback"] = fmt != requested_format

    try:
        with slots(dataset["erddap_url"]):
            if source_type == "obis":
                _download_obis(dataset, user_query, regions, fmt, row, folder)
            else:
                _download_erddap(dataset, user_query, regions, fmt, row, folder, budget)
    except Exception as e:
        # One dataset failing must not lose the rest of the user's download.
        for file in row["files"]:
            (root / file["path"]).unlink(missing_ok=True)
        row.update(status=FAILED, reason_code=UNKNOWN_ERROR, files=[])
        row["erddap_error"] = "\n".join(filter(None, [row["erddap_error"], f"{type(e).__name__}: {e}"]))
        logger.bind(erddap_url=dataset["erddap_url"], dataset_id=dataset["dataset_id"]).exception(
            "Downloader failed for dataset {}", dataset["dataset_id"]
        )

    row["warnings"] += save_source_metadata(dataset, folder)
    row["file_size"] = sum(f["bytes"] for f in row["files"])
    row["n_records"] = row["n_records"] or sum(f["n_rows"] for f in row["files"])
    row["total_size_so_far"] = budget.add(row["file_size"])
    row["no_data"] = not row["files"]
    row["finished_at"] = _now()
    return row


def get_datasets(json_query, output_path, size_limits=True):
    user_query = json_query["user_query"]
    regions = polygon_regions(user_query.get("polygon_region"))
    requested_format = user_query.get("format") or DEFAULT_FORMAT
    # The limits protect the server; a user's own run has none.
    if size_limits:
        budget = _QueryBudget(DATASET_SIZE_LIMIT, QUERY_SIZE_LIMIT)
    else:
        budget = _QueryBudget(sys.maxsize, sys.maxsize)
    slots = _ServerSlots()
    root = Path(output_path)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        rows = list(
            pool.map(
                lambda dataset: download_dataset(dataset, user_query, regions, requested_format, root, budget, slots),
                json_query["cache_filtered"],
            )
        )

    return {
        "erddap_report": rows,
        "over_limit": any(row["query_limit_hit"] for row in rows),
        "total_size": budget.total,
        "empty_download": all(row["no_data"] for row in rows),
    }
