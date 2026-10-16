"""
download_erddap regroup a set of tool used by CDE to download ERDDAP datasets.
"""

import io
import json
import os
import sys
from urllib.parse import urlparse

import cde_harvester.sources.erddap.client as cde_harvester
import pandas as pd
import requests
import shapely.wkt
from cde_harvester.core.errors import HTTP_ERROR, UNKNOWN_ERROR
from cde_harvester.core.issues import erddap_error_text
from erddapy import ERDDAP
from loguru import logger
from shapely.geometry import Point

from erddap_downloader.download_pdf import download_pdf

ONE_MB = 10**6
DATASET_SIZE_LIMIT = 1000 * ONE_MB
QUERY_SIZE_LIMIT = 5000 * ONE_MB

# Some ERDDAP servers (e.g. data.cioospacific.ca) sit behind a WAF that 403s
# urllib's default User-Agent, which pandas' read_csv(url) uses.
REQUEST_HEADERS = {
    "User-Agent": "CIOOS-CDE-Downloader/1.0 (+https://catalogue.cioos.ca)"
}

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

    By default returns ALL variables, so science/payload columns without a
    cf_role are included. all_variables=False keeps only mandatory + cf_role.
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
    """

    e = ERDDAP(
        server=dataset_info["erddap_url"],
        protocol="tabledap",
    )

    e.response = response
    e.dataset_id = dataset_info["dataset_id"]
    # Without explicit variables an unconstrained URL is ".csv?", which ERDDAP
    # answers with a 302 to its HTML info page.
    if variables_list:
        e.variables = variables_list
    e.constraints = {}

    if "time_min" in user_constraint:
        e.constraints["time>="] = user_constraint["time_min"]
    if "time_max" in user_constraint:
        e.constraints["time<="] = user_constraint["time_max"]

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

    if "depth" in variables_list:
        if "depth_min" in user_constraint and user_constraint["depth_min"]:
            e.constraints["depth>="] = user_constraint["depth_min"]
        if "depth_max" in user_constraint and user_constraint["depth_max"]:
            e.constraints["depth<="] = user_constraint["depth_max"]

    return e.get_download_url()


def save_erddap_metadata(dataset, output_path, file_name="erddap_metadata.csv"):
    e = ERDDAP(server=dataset["erddap_url"], protocol="tabledap", response="csv")
    e.dataset_id = dataset["dataset_id"]

    metadata_url = e.get_info_url()

    # Not pd.read_csv(url): urllib's UA gets 403 from WAF-protected servers.
    resp = requests.get(metadata_url, headers=REQUEST_HEADERS, timeout=60)
    resp.raise_for_status()
    df_meta = pd.read_csv(io.StringIO(resp.text))
    df_meta.insert(loc=0, column="erddap_url", value=dataset["erddap_url"])
    df_meta.insert(loc=1, column="dataset_id", value=dataset["dataset_id"])

    output_file_path = os.path.join(output_path, file_name)
    if os.path.exists(output_file_path):
        df_meta.to_csv(output_file_path, index=False, mode="a", header=False)
    else:
        df_meta.to_csv(output_file_path, index=False)


def get_file_name_output(dataset_info, output_path, extension):
    """
    Generate default file name output to use for each dataset downloaded.
    """
    file_name = "{}_{}".format(
        dataset_info["dataset_id"], erddap_server_to_name(dataset_info["erddap_url"])
    )
    return os.path.join(output_path, f"{file_name}.{extension}")


OBIS_PARQUET_URL = "https://obis-open-data.s3.amazonaws.com/occurrence/{dataset_id}.parquet"
OBIS_DATASET_API = "https://api.obis.org/v3/dataset/{dataset_id}"


def save_obis_metadata(dataset_id, output_path):
    """Write the OBIS dataset-level metadata alongside the occurrence CSV.
    Best-effort — a failure here must not fail the download."""
    try:
        resp = requests.get(
            OBIS_DATASET_API.format(dataset_id=dataset_id),
            headers=REQUEST_HEADERS,
            timeout=30,
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
    selection from the OBIS open-data GeoParquet export (OBIS datasets are not
    ERDDAP-backed). Returns a report entry shaped like the ERDDAP path's.
    """
    dataset_id = dataset["dataset_id"]
    url = OBIS_PARQUET_URL.format(dataset_id=dataset_id)

    # Bounding the DuckDB read server-side keeps the transfer small.
    def _coord(key, default):
        # Not `or`: 0.0 is a valid coordinate.
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

    # The same columns the harvester reads; reliably present across OBIS exports.
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
        import duckdb

        df = duckdb.sql(query).df()

        depth_min = user_query.get("depth_min")
        depth_max = user_query.get("depth_max")
        if depth_max not in (None, "") and not pd.isna(depth_max):
            df = df[df["minimumDepthInMeters"].fillna(0).astype(float) <= float(depth_max)]
        if depth_min not in (None, "") and not pd.isna(depth_min):
            df = df[df["maximumDepthInMeters"].fillna(0).astype(float) >= float(depth_min)]

        # date_start/date_end are epoch milliseconds in the OBIS export.
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

        # Regions include the ±360 antimeridian duplicates built by get_datasets.
        if polygon_regions and not df.empty:
            df[["latitude", "longitude"]] = df[["latitude", "longitude"]].astype(float)
            inside = df.apply(
                lambda x: any(
                    r.contains(Point(x.longitude, x.latitude)) for r in polygon_regions
                ),
                axis=1,
            )
            df = df[inside]

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


def filter_polygon_region(data, polygone):
    """
    ERDDAP is only compatible with a box method to filter lat/long data.
    This present tool reads back the data downloaded and remove any data which is outside the provided polygone.
    """
    data[["latitude", "longitude"]] = data[["latitude", "longitude"]].astype(float)
    data = data.loc[
        data.apply(lambda x: polygone.contains(Point(x.longitude, x.latitude)), axis=1)
    ]

    return data


def get_datasets(json_query, output_path="", create_pdf=False):
    """
    General method use to retrieve erddap datasets from a CDE query.
    """

    report = {
        "erddap_report": [],
        "over_limit": False,
        "total_size": 0,
        "empty_download": True,
    }

    polygon_region_wkt = json_query["user_query"].get("polygon_region")

    polygon_regions = [shapely.wkt.loads(polygon_region_wkt)] if polygon_region_wkt else []

    # Duplicate a polygon crossing ±180 so each side gets its own query.
    if polygon_regions and (polygon_regions[0].bounds[0] < -180 or polygon_regions[0].bounds[2] > 180):
        for shift in [-360, 360]:
            new_region = shapely.affinity.translate(polygon_regions[0], xoff=shift)
            if (
                -180 < new_region.bounds[0] < 180
                or -180 < new_region.bounds[2] < 180
            ):
                polygon_regions += [new_region]

    chunksize = 1024**2  # 1MB

    for dataset in json_query["cache_filtered"]:
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

        # Initialised outside the try so the except below can still build a
        # report row for a dataset that blew up mid-download.
        df = pd.DataFrame()
        units = pd.Series(dtype=str)
        bytes_downloaded = 0
        file_size = 0
        download_status = DOWNLOADING
        download_url_list = []
        # One entry per failed region: an antimeridian-split query issues
        # several requests and any of them can fail.
        erddap_errors = []
        reason_code = None

        try:
            if (
                "erddap_metadata" not in dataset
                or "globals" not in dataset["erddap_metadata"]
                or "variables" not in dataset["erddap_metadata"]
                or dataset["erddap_metadata"]["variables"] == []
            ):

                harvest_erddap = cde_harvester.ERDDAP(dataset["erddap_url"])

                harvester_dataset = harvest_erddap.get_dataset(dataset["dataset_id"])

                dataset["erddap_metadata"] = harvester_dataset.df_variables

            variable_list = get_variable_list(dataset["erddap_metadata"])

            for polygon_region in polygon_regions or ["all"]:

                download_url = get_erddap_download_url(
                    dataset,
                    json_query["user_query"],
                    variable_list,
                    polygon_region=polygon_region,
                )

                download_url_list += [download_url]

                if (
                    report["total_size"] > QUERY_SIZE_LIMIT
                    or bytes_downloaded > DATASET_SIZE_LIMIT
                ):
                    download_status = IGNORED
                    continue

                logger.info(f"Download {download_url}")
                data_downloaded = b""
                with requests.get(
                    download_url, headers=REQUEST_HEADERS, stream=True
                ) as response:
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

                    for chunk in response.iter_content(chunk_size=chunksize):
                        bytes_downloaded += sys.getsizeof(chunk)
                        data_downloaded += chunk

                        if bytes_downloaded > DATASET_SIZE_LIMIT:
                            download_status = PARTIAL
                            print("Reached download limit per dataset!")
                            break

                print(f"Downloaded {bytes_downloaded/ONE_MB:.3f} MB")

                # ERDDAP CSV: header on the first line, units on the second.
                df_temp = pd.read_csv(io.BytesIO(data_downloaded), low_memory=False)
                units = df_temp.iloc[0].replace({pd.NA: ""}).astype(str)
                df_temp = df_temp.iloc[1:]

                if polygon_region != "all":
                    df_temp = filter_polygon_region(df_temp, polygon_region)

                df = pd.concat([df, df_temp])
            if download_status == DOWNLOADING:
                download_status = COMPLETED

            if not df.empty:
                report["empty_download"] = False
                if "time" in df.columns:
                    df = df.sort_values("time")

                output_file_path = get_file_name_output(dataset, output_path, "csv")
                with open(output_file_path, "w") as f:
                    f.write(",".join(list(df.columns)) + "\n")
                    f.write(",".join(units.to_list()) + "\n")

                    df.to_csv(f, mode="a", header=False, index=False, lineterminator="\n")

                file_size = os.stat(output_file_path).st_size
            if download_status in [COMPLETED, PARTIAL]:
                # ckan_url is the full catalogue URL, NULL without a ckan_id.
                if create_pdf and dataset["ckan_url"]:
                    pdf_filename = get_file_name_output(dataset, output_path, "pdf")
                    download_pdf(dataset["ckan_url"], pdf_filename)

                save_erddap_metadata(dataset, output_path=output_path)

        except Exception as e:
            # One dataset failing must not lose the rest of the user's download.
            download_status = FAILED
            reason_code = UNKNOWN_ERROR
            erddap_errors.append(f"{type(e).__name__}: {e}")
            logger.bind(
                erddap_url=dataset["erddap_url"],
                dataset_id=dataset["dataset_id"],
            ).exception("ERDDAP downloader failed for dataset {}", dataset["dataset_id"])

        # Outside the try: a dataset that wrote a file and then failed (on the
        # PDF or metadata fetch) still counts against the query size budget.
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
