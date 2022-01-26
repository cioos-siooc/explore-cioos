"""
download_erddap regroup a set of tool used by CEDA to download ERDDAP datasets.
"""
import io
import os
import sys
from urllib.parse import urlparse

import erddap_scraper.ERDDAP as erddap_scraper
import pandas as pd
import requests
import shapely.wkt
from erddap_downloader.download_pdf import download_pdf
from erddap_scraper.utils import eov_to_standard_names
from erddapy import ERDDAP
from shapely.geometry import Point

ONE_MB = 10 ** 6
DATASET_SIZE_LIMIT = 10 * ONE_MB
QUERY_SIZE_LIMIT = 100 * ONE_MB

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


def get_variable_list(df_variables, eovs: list):
    """
    Retrieve the list of variables needed within an ERDDAP dataset based on the eovs list provided by the
     user and the mandatory variables required.
    :param erddap_metadata: erddap dataset attributes dataframe
    :param eovs: eov list requested by the query
    :return: list of variables to download from erddap
    """
    # Get a list of mandatory variables to be present if available
    mandatory_variables = ["time", "latitude", "longitude", "depth"]

    eov_variables = []

    for eov in eovs:
        if eov in eov_to_standard_names:
            eov_variables += eov_to_standard_names[eov]

    variables_to_download = df_variables.query(
        "(name in @mandatory_variables) or (standard_name in @eov_variables) or (cf_role != '')"
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
    e.constraints = {}

    # Add constraint for time range
    if "time_min" in user_constraint:
        e.constraints["time>="] = user_constraint["time_min"]
    if "time_max" in user_constraint:
        e.constraints["time<="] = user_constraint["time_max"]

    # Add constraint for lat/long range
    # If polygon given get the boundaries for erddap
    if polygon_region:
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

    # Add variable list to retrieve
    e.variables = variables_list

    # Get Download Link
    return e.get_download_url()


def save_erddap_metadata(dataset, output_path, file_name="erddaps_metadata.csv"):
    # Define ERDDAPy dataset connection
    e = ERDDAP(server=dataset["erddap_url"], protocol="tabledap", response="csv")
    e.dataset_id = dataset["dataset_id"]

    # Retrieve info url
    metadata_url = e.get_info_url()

    # Retrieve metadata and add server url and dataset_id
    df_meta = pd.read_csv(metadata_url)
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
    file_name = "{0}_{1}".format(
        dataset_info["dataset_id"], erddap_server_to_name(dataset_info["erddap_url"])
    )
    return os.path.join(output_path, f"{file_name}.{extension}")


def filter_polygon_region(data, polygone):
    """
    ERDDAP is only compatible with a box method to filter lat/long data.
    This present tool reads back the data downloaded and remove any data which is outside the provided polygone.
    It assume that the latitude and longitude data is saved within the corresponding variables.
    :param file_path: path to the file data.
    :param polygone: Polygone region to use
    """
    # Retrieve lat/long and keep only data within the polygon
    data[["latitude", "longitude"]] = data[["latitude", "longitude"]].astype(float)
    data = data.loc[
        data.apply(lambda x: polygone.contains(Point(x.longitude, x.latitude)), axis=1)
    ]

    return data


def get_datasets(json_query, output_path="", create_pdf=False):
    """
    General method use to retrieve erddap datasets from a ceda query.
    :param json_query: JSON CEDA query
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
    if "polygon_region" in json_query["user_query"]:
        polygon_regions = [
            shapely.wkt.loads(json_query["user_query"]["polygon_region"])
        ]

    # Duplicate polygon over -180 to 180 limit and generate multiple queries to match each side
    if polygon_regions[0].bounds[0] < -180 or polygon_regions[0].bounds[2] > 180:
        for shift in [-360, 360]:
            new_region = shapely.affinity.translate(polygon_regions[0], xoff=shift)
            if -180 < new_region.bounds[0] < 180 or -180 < new_region.bounds[2] < 180:
                polygon_regions += [new_region]

    # Download file locally
    chunksize = 1024 ** 2  # 1MB

    # Download data to drive, down
    for dataset in json_query["cache_filtered"]:
        # If metadata for the dataset is not available retrieve it
        if (
            "erddap_metadata" not in dataset
            or "globals" not in dataset["erddap_metadata"]
            or "variables" not in dataset["erddap_metadata"]
            or dataset["erddap_metadata"]["variables"] == []
        ):

            scrape_erddap = erddap_scraper.ERDDAP(dataset["erddap_url"])

            scraper_dataset = scrape_erddap.get_dataset(dataset["dataset_id"])

            dataset["erddap_metadata"] = scraper_dataset.df_variables

        # Get variable list to download
        variable_list = get_variable_list(
            dataset["erddap_metadata"],
            json_query["user_query"]["eovs"],
        )

        # Try getting data
        df = pd.DataFrame()
        bytes_downloaded = 0
        file_size = 0
        download_status = DOWNLOADING
        download_url_list = []
        erddap_error = ""
        for polygon_region in polygon_regions:

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
            print(f"Download {download_url}")
            data_downloaded = b""
            with requests.get(download_url, stream=True) as response:
                # Make sure the connection is working otherswise make a warning and send the error.
                if response.status_code != 200:
                    if response.status_code == 404:
                        download_status = EMPTY
                    else:
                        download_status = FAILED

                    erddap_error = response.text
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

            # Filter data to polygon
            df_temp = filter_polygon_region(df_temp, polygon_region)

            # Append data to previously downloaded one
            df = df.append(df_temp)

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
                df.to_csv(f, mode="a", header=False, index=False, line_terminator="\n")
                file_size = os.stat(output_file_path).st_size

        # Generate report for each download
        # Return download report
        if download_status in [COMPLETED, PARTIAL]:
            if create_pdf and dataset["ckan_url"] and dataset["ckan_id"]:
                ckan_url = dataset["ckan_url"] + dataset["ckan_id"]
                pdf_filename = get_file_name_output(dataset, output_path, "pdf")
                download_pdf(ckan_url, pdf_filename)

            # Retrieve metadata
            save_erddap_metadata(dataset, output_path=output_path)

        dataset_report = {
            "dataset_id": dataset["dataset_id"],
            "download_url_list": download_url_list,
            "status": download_status,
            "file_size": file_size,
            "bytes_downloaded": bytes_downloaded,
            "no_data": df.empty,
            "dataset_limit_hit": bytes_downloaded > DATASET_SIZE_LIMIT,
            "query_limit_hit": report["total_size"] > QUERY_SIZE_LIMIT,
            "erddap_error": erddap_error,
            "total_size_so_far": report["total_size"],
        }

        report["erddap_report"] += [dataset_report]
        report["total_size"] += file_size

    return report
