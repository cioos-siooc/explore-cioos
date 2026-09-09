"""
download_erddap regroup a set of tool used by CDE to download ERDDAP datasets.
"""

import io
import json
import os
import sys
from urllib.parse import urlparse

import duckdb
import numpy as np
import pandas as pd
import shapely.wkt
from erddapy import ERDDAP
from loguru import logger
from shapely import contains, points

from cde_common.errors import HTTP_ERROR, UNKNOWN_ERROR
from cde_common.http import DATA_TIMEOUT, DEFAULT_TIMEOUT, retry_session
from cde_common.issues import erddap_error_text
from erddap_downloader.download_pdf import download_pdf

ONE_MB = 10**6
DATASET_SIZE_LIMIT = 1000 * ONE_MB
QUERY_SIZE_LIMIT = 5000 * ONE_MB

# Some ERDDAP servers (e.g. data.cioospacific.ca) sit behind a WAF that blocks
# urllib's default "Python-urllib/x.y" User-Agent with HTTP 403. pandas'
# read_csv(url) uses urllib, so metadata fetches must go through requests with
# an explicit UA instead. Reuse this UA on the data requests too.
REQUEST_HEADERS = {
    "User-Agent": "CIOOS-CDE-Downloader/1.0 (+https://catalogue.cioos.ca)"
}

# One session for every outbound request: retries the transient statuses that
# used to fail a user's whole download (a 502 from a proxy, a WAF 413 under
# parallel load) and keeps connections warm across the datasets in one job.
session = retry_session(headers=REQUEST_HEADERS)

DOWNLOADING = "DOWNLOADING"
COMPLETED = "COMPLETED"
PARTIAL = "PARTIAL"
FAILED = "FAILED"
EMPTY = "EMPTY"
IGNORED = "IGNORED"


def erddap_server_to_name(server):
    """
    Read erddap server url and convert it to a readable string format to be use as part of the file name output/
    :param server: erddap server url
    :return: erddap server string
    """
    return urlparse(server).netloc.replace(".", "_")


def get_variable_list(df_variables: list, all_variables: bool = True):
    """
    Retrieve the list of variables to download from an ERDDAP dataset.

    By default returns ALL variables, so science/payload columns (e.g. a
    glider's temperature/salinity, which have no cf_role) are included — the
    previous "mandatory + cf_role only" reduction silently dropped them,
    leaving trajectory downloads with just time/lat/lon/depth + trajectory_id.
    Set all_variables=False to fall back to that reduced set.
    :param df_variables: erddap dataset attributes dataframe
    :param all_variables: keep every variable (default) vs. mandatory + cf_role
    :return: list of variables to download from erddap
    """
    if all_variables:
        return df_variables["name"].to_list()

    # Reduced set: mandatory coordinates plus any cf_role-tagged variable.
    mandatory_variables = ["time", "latitude", "longitude", "depth"]  # noqa: F841 — read by the @-reference in the query below
    variables_to_download = df_variables.query(
        "(name in @mandatory_variables) or (cf_role != '')"
    )["name"].to_list()

    return variables_to_download


def get_erddap_download_url(
    dataset_info: dict,
    user_constraint: dict,
    variables_list: list,
    polygon_region,
    response: str = "csv",
):
    """
    Method to retrieve the an ERDDAP download url based on the query provided by the user.
    :param dataset_info:
    :param user_constraint:
    :param variables_list:
    :return: url string
    """

    # Create ERDDAPy instance
    e = ERDDAP(
        server=dataset_info["erddap_url"],
        protocol="tabledap",
    )

    e.response = response
    e.dataset_id = dataset_info["dataset_id"]
    # Request the variables explicitly. Without this the URL is ".csv?" when no
    # constraints apply (no time/space/depth filter), which ERDDAP rejects with a
    # 302 redirect to its info page — pandas then fails parsing the HTML. Listing
    # the variables makes it a valid ".csv?var1,var2,..." request.
    if variables_list:
        e.variables = variables_list
    e.constraints = {}

    # Add constraint for time range
    if "time_min" in user_constraint:
        e.constraints["time>="] = user_constraint["time_min"]
    if "time_max" in user_constraint:
        e.constraints["time<="] = user_constraint["time_max"]

    # Add constraint for lat/long range
    # If polygon given get the boundaries for erddap
    if polygon_region != "all":
        (
            user_constraint["lon_min"],
            user_constraint["lat_min"],
            user_constraint["lon_max"],
            user_constraint["lat_max"],
        ) = polygon_region.bounds

        if (
            "lat_min" in user_constraint
            and "lat_max" in user_constraint
            and "lon_min" in user_constraint
            and "lon_max" in user_constraint
        ):
            # Limit longitudes to [-180 to 180] range
            if user_constraint["lon_min"] < -180:
                user_constraint["lon_min"] = -180

            if user_constraint["lon_max"] > 180:
                user_constraint["lon_max"] = 180

            e.constraints["latitude>="] = user_constraint["lat_min"]
            e.constraints["latitude<="] = user_constraint["lat_max"]

            e.constraints["longitude>="] = user_constraint["lon_min"]
            e.constraints["longitude<="] = user_constraint["lon_max"]

    # Add depth filter
    if "depth" in variables_list:
        if "depth_min" in user_constraint and user_constraint["depth_min"]:
            e.constraints["depth>="] = user_constraint["depth_min"]
        if "depth_max" in user_constraint and user_constraint["depth_max"]:
            e.constraints["depth<="] = user_constraint["depth_max"]

    # Get Download Link
    return e.get_download_url()


def get_erddap_info(dataset):
    """The dataset's ERDDAP ``/info/`` table: one row per variable and attribute.

    Fetched via requests, not ``pd.read_csv(url)``: pandas uses urllib, whose
    default User-Agent is answered with 403 by the WAF in front of some ERDDAP
    servers (e.g. data.cioospacific.ca).
    """
    e = ERDDAP(server=dataset["erddap_url"], protocol="tabledap", response="csv")
    e.dataset_id = dataset["dataset_id"]

    resp = session.get(e.get_info_url(), timeout=DEFAULT_TIMEOUT)
    resp.raise_for_status()
    return pd.read_csv(io.StringIO(resp.text)).fillna("")


def get_variables_from_info(df_info):
    """The ``name``/``cf_role`` frame ``get_variable_list`` reads, from an info table.

    This used to be obtained by constructing the *harvester's* ``Dataset``
    object, which fetches this same ``/info/`` table and pivots far more out of
    it than the download path ever looks at — and which dragged Prefect,
    duckdb, redis and pandera into the downloader behind an ERDDAP reader. The
    row predicate is the harvester's: an attribute-less, non-global row is a
    variable (or a griddap dimension).
    """
    variables = df_info.query(
        '`Variable Name` != "NC_GLOBAL" and `Attribute Name` == ""'
    )[["Variable Name"]].rename(columns={"Variable Name": "name"})
    cf_roles = (
        df_info.query('`Attribute Name` == "cf_role"')
        .set_index("Variable Name")["Value"]
    )
    variables["cf_role"] = variables["name"].map(cf_roles).fillna("")
    return variables


def save_erddap_metadata(dataset, output_path, file_name="erddap_metadata.csv"):
    df_meta = get_erddap_info(dataset)
    df_meta.insert(loc=0, column="erddap_url", value=dataset["erddap_url"])
    df_meta.insert(loc=1, column="dataset_id", value=dataset["dataset_id"])

    # If file exist already append to it
    output_file_path = os.path.join(output_path, file_name)
    if os.path.exists(output_file_path):
        df_meta.to_csv(output_file_path, index=False, mode="a", header=False)
    else:
        df_meta.to_csv(output_file_path, index=False)


def get_file_name_output(dataset_info, output_path, extension):
    """
    Generate default file name output to use for each dataset downloaded.
    :param dataset_info: cache dataset info
    :return:
    """
    # Output file is {erddap server}_{dataset_id}_{CKAN_ID}
    file_name = "{}_{}".format(
        dataset_info["dataset_id"], erddap_server_to_name(dataset_info["erddap_url"])
    )
    return os.path.join(output_path, f"{file_name}.{extension}")


OBIS_PARQUET_URL = "https://obis-open-data.s3.amazonaws.com/occurrence/{dataset_id}.parquet"
OBIS_DATASET_API = "https://api.obis.org/v3/dataset/{dataset_id}"


def save_obis_metadata(dataset_id, output_path):
    """Write the OBIS dataset-level metadata (title, abstract, node, extent,
    record counts, etc.) alongside the occurrence CSV. Mirrors the harvester's
    metadata source. Best-effort — a failure here must not fail the download."""
    try:
        resp = session.get(
            OBIS_DATASET_API.format(dataset_id=dataset_id),
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        metadata = results[0] if results else {}
        out_path = os.path.join(output_path, f"{dataset_id}_obis_metadata.json")
        with open(out_path, "w") as f:
            json.dump(metadata, f, indent=2)
    except Exception as e:
        logger.warning("Failed to fetch OBIS metadata for {}: {}", dataset_id, e)


def download_obis_parquet(dataset, user_query, output_path, polygon_regions):
    """
    Download an OBIS dataset's occurrence records for the user's spatial/time/depth
    selection, reading the OBIS open-data GeoParquet export directly with DuckDB
    (same source the harvester ingests from) and writing a filtered CSV.

    OBIS datasets are not ERDDAP-backed (erddap_url is the https://obis.org
    sentinel), so the tabledap path can't serve them. Returns a per-dataset report
    entry with the same shape as the ERDDAP path so the scheduler/email logic is
    unchanged.
    """
    dataset_id = dataset["dataset_id"]
    url = OBIS_PARQUET_URL.format(dataset_id=dataset_id)

    # Bounding box for the DuckDB read: the polygon envelope if drawn, else the
    # user's rectangle, else the whole (web-mercator-valid) world. Bounding the
    # read server-side keeps the transfer small.
    def _coord(key, default):
        # Only fall back on missing/None — 0.0 is a valid coordinate, so `or`
        # defaulting would be wrong here.
        val = user_query.get(key)
        if val is None or (isinstance(val, float) and pd.isna(val)) or val == "":
            return default
        return float(val)

    if polygon_regions:
        lons = [b for r in polygon_regions for b in (r.bounds[0], r.bounds[2])]
        lats = [b for r in polygon_regions for b in (r.bounds[1], r.bounds[3])]
        lon_min, lon_max = max(min(lons), -180), min(max(lons), 180)
        lat_min, lat_max = max(min(lats), -85.06), min(max(lats), 85.06)
    else:
        lon_min = max(_coord("lon_min", -180), -180)
        lon_max = min(_coord("lon_max", 180), 180)
        lat_min = max(_coord("lat_min", -85.06), -85.06)
        lat_max = min(_coord("lat_max", 85.06), 85.06)

    # Columns pulled from the `interpreted` struct + _id — the proven set the
    # harvester reads (sources/obis/harvester.py); reliably present across OBIS
    # parquet exports.
    query = f"""
        SELECT
            _id                              AS id,
            interpreted.scientificName       AS scientificName,
            interpreted.decimalLatitude      AS latitude,
            interpreted.decimalLongitude     AS longitude,
            interpreted.date_start           AS date_start,
            interpreted.date_end             AS date_end,
            interpreted.minimumDepthInMeters AS minimumDepthInMeters,
            interpreted.maximumDepthInMeters AS maximumDepthInMeters
        FROM read_parquet('{url}')
        WHERE interpreted.decimalLatitude  BETWEEN {lat_min} AND {lat_max}
          AND interpreted.decimalLongitude BETWEEN {lon_min} AND {lon_max}
    """

    download_status = DOWNLOADING
    file_size = 0
    n_records = 0
    obis_error = ""
    reason_code = None
    try:
        df = duckdb.sql(query).df()

        # Depth filter (numeric columns).
        depth_min = user_query.get("depth_min")
        depth_max = user_query.get("depth_max")
        if depth_max not in (None, "") and not pd.isna(depth_max):
            df = df[df["minimumDepthInMeters"].fillna(0).astype(float) <= float(depth_max)]
        if depth_min not in (None, "") and not pd.isna(depth_min):
            df = df[df["maximumDepthInMeters"].fillna(0).astype(float) >= float(depth_min)]

        # Time filter — date_start/date_end are epoch milliseconds in the OBIS
        # export. Best-effort: skip if the columns don't parse as numeric.
        try:
            for bound, col, op in (
                ("time_min", "date_end", "ge"),
                ("time_max", "date_start", "le"),
            ):
                val = user_query.get(bound)
                if val:
                    ts = pd.to_datetime(val, utc=True)
                    coldt = pd.to_datetime(df[col], unit="ms", utc=True, errors="coerce")
                    df = df[coldt.ge(ts) if op == "ge" else coldt.le(ts)]
        except Exception as e:
            logger.warning("OBIS time filter skipped for {}: {}", dataset_id, e)

        # Refine to the drawn polygon(s) row-by-row: keep a record if it falls
        # inside ANY region (regions include the ±360 antimeridian duplicates
        # built by get_datasets).
        if polygon_regions and not df.empty:
            df = df[points_in_any_region(df, polygon_regions)]

        n_records = len(df)
        if not df.empty:
            output_file_path = get_file_name_output(dataset, output_path, "csv")
            df.to_csv(output_file_path, index=False, lineterminator="\n")
            file_size = os.stat(output_file_path).st_size
            save_obis_metadata(dataset_id, output_path)
            download_status = COMPLETED
        else:
            download_status = EMPTY
    except Exception as e:
        download_status = FAILED
        reason_code = UNKNOWN_ERROR
        obis_error = str(e)
        logger.error(
            "OBIS parquet download error for {}: {}",
            dataset_id,
            e,
            extra={"dataset_id": dataset_id, "parquet_url": url},
        )

    return {
        "erddap_url": dataset["erddap_url"],
        "dataset_id": dataset_id,
        "ckan_id": dataset.get("ckan_id"),
        "download_url_list": [url],
        "status": download_status,
        "file_size": file_size,
        "bytes_downloaded": file_size,
        "no_data": download_status in (EMPTY, FAILED),
        "dataset_limit_hit": False,
        "query_limit_hit": False,
        "reason_code": reason_code,
        "erddap_error": obis_error,
        "n_records": n_records,
    }


def points_in_any_region(data, regions):
    """Boolean mask: True where a row's (latitude, longitude) is inside ANY region.

    Vectorized through shapely 2.x — one C call per region over the whole
    column — rather than building a Point per row. Same pattern the harvester
    uses in sources/obis/geo_filter.filter_points; the row-wise `.apply` this
    replaced was ~36x slower on a 200k-row download and returned a DataFrame
    instead of a Series on an empty frame.

    Mutates `data` to coerce the two coordinate columns to float, as the
    row-wise version did.
    """
    data[["latitude", "longitude"]] = data[["latitude", "longitude"]].astype(float)
    pts = points(data["longitude"].values, data["latitude"].values)
    return np.logical_or.reduce([contains(region, pts) for region in regions])


def filter_polygon_region(data, polygone):
    """
    ERDDAP is only compatible with a box method to filter lat/long data.
    This present tool reads back the data downloaded and remove any data which is outside the provided polygone.
    It assume that the latitude and longitude data is saved within the corresponding variables.
    :param file_path: path to the file data.
    :param polygone: Polygone region to use
    """
    return data.loc[points_in_any_region(data, [polygone])]


def get_datasets(json_query, output_path="", create_pdf=False):
    """
    General method use to retrieve erddap datasets from a CDE query.
    :param json_query: JSON CDE query
    :param output_path: path where to save the downloaded data.
    """

    # Downloader report
    report = {
        "erddap_report": [],
        "over_limit": False,
        "total_size": 0,
        "empty_download": True,
    }

    # Convert WKT polygon to shapely polygon object
    polygon_region_wkt = json_query["user_query"].get("polygon_region")

    polygon_regions = [shapely.wkt.loads(polygon_region_wkt)] if polygon_region_wkt else []

    # Duplicate polygon over -180 to 180 limit and generate multiple queries to match each side
    if polygon_regions and (polygon_regions[0].bounds[0] < -180 or polygon_regions[0].bounds[2] > 180):
        for shift in [-360, 360]:
            new_region = shapely.affinity.translate(polygon_regions[0], xoff=shift)
            if (
                -180 < new_region.bounds[0] < 180
                or -180 < new_region.bounds[2] < 180
            ):
                polygon_regions += [new_region]

    # Download file locally
    chunksize = 1024**2  # 1MB

    # Download data to drive, down
    for dataset in json_query["cache_filtered"]:
        # OBIS datasets aren't ERDDAP-backed — pull their occurrences from the
        # OBIS parquet export instead of the tabledap path.
        if dataset.get("source_type") == "obis":
            obis_report = download_obis_parquet(
                dataset, json_query["user_query"], output_path, polygon_regions
            )
            if not obis_report["no_data"]:
                report["empty_download"] = False
            report["total_size"] += obis_report["file_size"]
            obis_report["total_size_so_far"] = report["total_size"]
            report["erddap_report"] += [obis_report]
            continue

        # Per-dataset outcome. Tracked out here so the except below can still
        # build a report row for a dataset that blew up mid-download. The
        # metadata fetch below is inside that try too, so an unreachable ERDDAP
        # server marks its own dataset FAILED instead of losing the whole job.
        df = pd.DataFrame()
        units = pd.Series(dtype=str)
        bytes_downloaded = 0
        file_size = 0
        download_status = DOWNLOADING
        download_url_list = []
        # One entry per failed region: a split query (a polygon crossing the
        # antimeridian) issues several requests and any of them can fail, so a
        # single slot would keep only the last error.
        erddap_errors = []
        reason_code = None

        try:
            # If metadata for the dataset is not available retrieve it
            if (
                "erddap_metadata" not in dataset
                or "globals" not in dataset["erddap_metadata"]
                or "variables" not in dataset["erddap_metadata"]
                or dataset["erddap_metadata"]["variables"] == []
            ):

                dataset["erddap_metadata"] = get_variables_from_info(
                    get_erddap_info(dataset)
                )

            # Get variable list to download
            variable_list = get_variable_list(dataset["erddap_metadata"])

            for polygon_region in polygon_regions or ["all"]:

                # Get download url
                download_url = get_erddap_download_url(
                    dataset,
                    json_query["user_query"],
                    variable_list,
                    polygon_region=polygon_region,
                )

                # Add URL to the lis tof URL for this dataset
                download_url_list += [download_url]

                # If maximum size of query reached just don't download and give query url
                # or if maximum download for this dataset is reached
                if (
                    report["total_size"] > QUERY_SIZE_LIMIT
                    or bytes_downloaded > DATASET_SIZE_LIMIT
                ):
                    download_status = IGNORED
                    continue

                # Download data
                logger.info(f"Download {download_url}")
                data_downloaded = b""
                # A timeout is not optional here: this is the scheduler's single
                # threaded main path, so an ERDDAP that accepts the connection and
                # then goes silent used to wedge the whole download queue forever.
                # DATA_TIMEOUT is generous (ERDDAP can be slow to produce the first
                # byte of a large query) but finite, and it also applies between
                # chunks, so a stalled mid-stream transfer is caught too.
                with session.get(
                    download_url, stream=True, timeout=DATA_TIMEOUT
                ) as response:
                    # Make sure the connection is working otherswise make a warning and send the error.
                    if response.status_code != 200:
                        if response.status_code == 404:
                            # ERDDAP answers 404 for "no matching data", which is
                            # an empty result for the user, not a server problem.
                            download_status = EMPTY
                        else:
                            download_status = FAILED
                            reason_code = HTTP_ERROR

                        server_error = erddap_error_text(response)
                        erddap_errors.append(
                            f"HTTP {response.status_code} {response.reason}"
                            + (f": {server_error}" if server_error else "")
                        )
                        logger.bind(
                            erddap_url=dataset["erddap_url"],
                            dataset_id=dataset["dataset_id"],
                            download_url=download_url,
                            status_code=response.status_code,
                        ).error(
                            "ERDDAP downloader download error: HTTP {} - {} - {}",
                            response.status_code,
                            dataset["erddap_url"],
                            server_error,
                        )
                        continue

                    # Download data up to maximum size allowed
                    for chunk in response.iter_content(chunk_size=chunksize):
                        # Get data downloaded
                        bytes_downloaded += sys.getsizeof(chunk)
                        data_downloaded += chunk

                        # Stop download limit per dataset is reached
                        if bytes_downloaded > DATASET_SIZE_LIMIT:
                            download_status = PARTIAL
                            print("Reached download limit per dataset!")
                            break

                # Update how much download done
                print(f"Downloaded {bytes_downloaded/ONE_MB:.3f} MB")

                # Parse downloaded data
                # Read CSV file with pandas
                # Retrieve header and units on the first and second lines
                df_temp = pd.read_csv(io.BytesIO(data_downloaded), low_memory=False)
                units = df_temp.iloc[0].replace({pd.NA: ""}).astype(str)  # get units
                df_temp = df_temp.iloc[1:]

                if polygon_region != "all":
                    # Filter data to polygon
                    df_temp = filter_polygon_region(df_temp, polygon_region)

                # Append data to previously downloaded one
                df = pd.concat([df, df_temp])
            # If download status hasn't changed, download was successfully completed
            if download_status == DOWNLOADING:
                download_status = COMPLETED

            if not df.empty:
                report["empty_download"] = False
                # Sort data along time
                if "time" in df.columns:
                    df = df.sort_values("time")

                # Save to file
                output_file_path = get_file_name_output(dataset, output_path, "csv")
                with open(output_file_path, "w") as f:
                    # Write Header
                    f.write(",".join(list(df.columns)) + "\n")
                    f.write(",".join(units.to_list()) + "\n")

                    # Write Data
                    df.to_csv(f, mode="a", header=False, index=False, lineterminator="\n")

                file_size = os.stat(output_file_path).st_size
            # Generate report for each download
            # Return download report
            if download_status in [COMPLETED, PARTIAL]:
                # ckan_url is the full catalogue URL for the dataset, as built
                # by the API (web-api/routes/download.js, matching shapeQuery.js)
                # and by the scheduler's email. It used to be emitted as a bare
                # prefix that this line completed, which made the name mean two
                # different things in two services; it is NULL when the dataset
                # has no ckan_id.
                if create_pdf and dataset["ckan_url"]:
                    pdf_filename = get_file_name_output(dataset, output_path, "pdf")
                    download_pdf(dataset["ckan_url"], pdf_filename)

                # Retrieve metadata
                save_erddap_metadata(dataset, output_path=output_path)

        except Exception as e:
            # One dataset failing must not lose the rest of the user's download,
            # and an uncaught raise here would leave no record of what broke.
            download_status = FAILED
            reason_code = UNKNOWN_ERROR
            erddap_errors.append(f"{type(e).__name__}: {e}")
            logger.bind(
                erddap_url=dataset["erddap_url"],
                dataset_id=dataset["dataset_id"],
            ).exception("ERDDAP downloader failed for dataset {}", dataset["dataset_id"])

        # Outside the try: a dataset that wrote a file and then failed (on the
        # PDF or metadata fetch) still contributed to the query size budget.
        report["total_size"] += file_size

        dataset_report = {
            "erddap_url": dataset["erddap_url"],
            "dataset_id": dataset["dataset_id"],
            "ckan_id": dataset["ckan_id"],
            "download_url_list": download_url_list,
            "status": download_status,
            "file_size": file_size,
            "bytes_downloaded": bytes_downloaded,
            "no_data": df.empty,
            "dataset_limit_hit": bytes_downloaded > DATASET_SIZE_LIMIT,
            "query_limit_hit": report["total_size"] > QUERY_SIZE_LIMIT,
            "reason_code": reason_code,
            "erddap_error": "\n".join(erddap_errors),
            "total_size_so_far": report["total_size"],
        }

        report["erddap_report"] += [dataset_report]

    return report
