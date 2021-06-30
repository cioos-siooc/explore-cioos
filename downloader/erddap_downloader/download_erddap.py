"""
download_erddap regroup a set of tool used by CEDA to download ERDDAP datasets.
"""
from erddapy import ERDDAP
import shapely.wkt
from shapely.geometry import Point

import pandas as pd

import requests
import re
import json

import os

import warnings

import erddap_scraper.ERDDAP as erddap_scraper


def erddap_server_to_name(server):
    """
    Read erddap server url and convert it to a readable string format to be use as part of the file name output/
    :param server: erddap server url
    :return: erddap server string
    """
    server_string = re.sub(r"https*://|/erddap|\.(org|com|ca)", "", server)
    server_string = re.sub(r"\.", "-", server_string)
    return server_string.upper()


def get_variable_list(erddap_metadata: dict, eovs: list):
    """
    Retrieve the list of variables needed within an ERDDAP dataset based on the eovs list provided by the
     user and the mandatory variables required.
    :param erddap_metadata: erddap dataset attributes dictionary
    :param eovs: eov list requested by the query
    :return: list of variables to download from erddap
    """
    # Get a list of mandatory variables to be present if available
    mandatory_variables = ["time", "latitude", "longitude", "depth"]

    # Retrieve EOVs mapping to standard_name
    path_to_eov_mapper = os.path.dirname(os.path.realpath(__file__))
    with open(
        os.path.join(path_to_eov_mapper, "eovs_to_standard_name.json")
    ) as json_file:
        evos_to_standard_name = json.load(json_file)

    # Retrieve the list of standard_names to consider
    eov_variables = []
    for eov in eovs:
        if eov in evos_to_standard_name:
            eov_variables += evos_to_standard_name[eov]

    # Iterate over each variables and add to considered list if
    #   - mandatory_variable
    #   - cf_role
    #   - standard_name is considered
    variable_list = []
    for variable, attributes in erddap_metadata["variables"].items():
        if variable in mandatory_variables:
            variable_list += [variable]

        if "cf_role" in attributes:
            variable_list += [variable]

        if (
            "standard_name" in attributes
            and attributes["standard_name"] in eov_variables
        ):
            variable_list += [variable]
    return variable_list


def get_erddap_download_url(
    dataset_info: dict,
    user_constraint: dict,
    variables_list: list = None,
    polygon_region=None,
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

    e.response = user_constraint["response"]
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
    if variables_list:
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


def get_file_name_output(dataset_info, output_path, extension, file_suffix):
    """
    Generate default file name output to use for each dataset downloaded.
    :param dataset_info: cache dataset info
    :return:
    """
    # Output file is {erddap server}_{dataset_id}_{CKAN_ID}
    file_name = "{0}_{1}".format(
        dataset_info["dataset_id"], erddap_server_to_name(dataset_info["erddap_url"])
    )
    # Add suffix
    if file_suffix:
        file_name = file_name + file_suffix
    return os.path.join(output_path, f"{file_name}.{extension}")


def data_download_transform(response, output_path, type, polygon, report):
    """
    Method to retrieve data from an erddap server. If in CSV format, download data by chunk,
    filter by lat/long within the provided polygon and save to a csv file.
    Other format are directely saved to file.
    """
    # Download file locally
    chunk_id = 0
    max_file_size = 10 ** 8
    complete_download = "Completed"

    if type == "csv":
        max_chunk_number = 10000
        chunk_size = 10000
        get_header = True
        with open(output_path, "w") as f:
            for chunk in pd.read_csv(
                response.raw, compression="gzip", chunksize=chunk_size, low_memory=False
            ):
                # Read header and units and save them to output
                if get_header:
                    units = chunk.iloc[0]
                    chunk = chunk.iloc[1:]  # skip units
                    f.write(",".join(list(chunk.columns)) + "\n")
                    f.write(",".join(units.astype(str).to_list()) + "\n")
                    get_header = False

                # Filter data to polygon
                chunk = filter_polygon_region(chunk, polygon)
                chunk.to_csv(
                    f, mode="a", header=False, index=False, line_terminator="\n"
                )

                # Review file size and stop if exceed maximum size or if iterated to many times on download
                if os.stat(output_path).st_size > max_file_size:
                    complete_download = "Exceed File Size Limit"
                    break
                if chunk_id > max_chunk_number:
                    complete_download = "Exceed Server Download Limit"
                    break

                chunk_id += 1

    else:
        chunksize = max_file_size
        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=chunksize):
                # Download chunk
                f.write(chunk)
                chunk_id += 1

                if os.stat(output_path).st_size > max_file_size:
                    complete_download = "Exceed File Size Limit"
                    break

    # Return download report
    if complete_download == "Completed":
        print("Completed")
        result = "successful"
        result_description = os.stat(output_path).st_size
    elif complete_download == "Exceed File Size Limit":
        print("Partial")
        result = "warning"
        result_description = f"Reached download limit: >{max_file_size} bytes"
        warnings.warn(result_description)
    elif complete_download == "Exceed Server Download Limit":
        print("Partial")
        result = "warning"
        result_description = f"Reached Server Download Limit"
        warnings.warn(result_description)

    # Add download report
    report[result] += [{"query": response.url, "result": result_description}]

    return report


def filter_polygon_region(data, polygone):
    """
    ERDDAP is only compatible with a box method to filter lat/long data.
    This present tool reads back the data downloaded and remove any data which is outside the provided polygone.
    It assume that the latitude and longitude data is saved within the corresponding variables.
    :param file_path: path to the file data.
    :param polygone: Polygone region to use
    """

    # Determinate the type of data
    if isinstance(data, pd.DataFrame):
        data[["latitude", "longitude"]] = data[["latitude", "longitude"]].astype(float)
        data = data.loc[
            data.apply(
                lambda x: polygone.contains(Point(x.longitude, x.latitude)), axis=1
            )
        ]
    else:
        warnings.warn(
            "Polygon filtration is not compatible with {0} format".format(type(data))
        )

    return data


def get_dataset(json_query, output_path=""):
    """
    General method use to retrieve erddap datasets from a ceda query.
    :param json_query: JSON CEDA query
    :param output_path: path where to save the downloaded data.
    """
    # Convert WKT polygon to shapely polygon object
    if "polygon_region" in json_query["user_query"]:
        polygon_regions = [
            shapely.wkt.loads(json_query["user_query"]["polygon_region"])
        ]

    # Make ERDDAP CSV output default output
    if "response" not in json_query["user_query"]:
        json_query["user_query"]["response"] = "csv"

    # Duplicate polygon over -180 to 180 limit and generate multiple queries to match each side
    if polygon_regions[0].bounds[0] < -180 or polygon_regions[0].bounds[2] > 180:
        for shift in [-360, 360]:
            new_region = shapely.affinity.translate(polygon_regions[0], xoff=shift)
            if -180 < new_region.bounds[0] < 180 or -180 < new_region.bounds[2] < 180:
                polygon_regions += [new_region]

    # Run through each datasets
    report = {
        "successful": [],
        "empty": [],
        "failed": [],
        "warning": [],
    }
    for dataset in json_query["cache_filtered"]:
        # If metadata for the dataset is not available retrieve it
        if (
            "erddap_metadata" not in dataset
            or "globals" not in dataset["erddap_metadata"]
            or "variables" not in dataset["erddap_metadata"]
            or dataset["erddap_metadata"]["variables"] == []
        ):
            scrape_erddap = erddap_scraper.ERDDAP(dataset["erddap_url"])
            dataset["erddap_metadata"] = scrape_erddap.get_metadata_for_dataset(
                dataset["dataset_id"]
            )

        # Get variable list to download
        variable_list = get_variable_list(
            dataset["erddap_metadata"],
            json_query["user_query"]["eovs"],
        )
        # Retrieve metadata
        save_erddap_metadata(dataset, output_path=output_path)

        # Try getting data
        query_id = 0
        for polygon_region in polygon_regions:
            try:
                # Get download url
                download_url = get_erddap_download_url(
                    dataset,
                    json_query["user_query"],
                    variable_list,
                    polygon_region=polygon_region,
                )
            except requests.exceptions.HTTPError as e:
                # Failed to get a download url
                warnings.warn(
                    "Failed to download data from erddap: {0} dataset_id:{1}. \n"
                    "{2}".format(
                        dataset["erddap_url"], dataset["dataset_id"], "\n".join(e.args)
                    )
                )
                continue

            # Generate the default file name
            if len(polygon_regions) > 1:
                file_suffix = f"_part{query_id}"
                query_id += 1
            else:
                file_suffix = None
            output_file_path = get_file_name_output(
                dataset, output_path, json_query["user_query"]["response"], file_suffix
            )

            # Download data
            print(f"Download {download_url}", end=" ... ")
            with requests.get(download_url, stream=True) as response:
                # Make sure the connection is working otherswise make a warning and send the error.
                if response.status_code != 200:
                    if response.status_code == 404:
                        result = "empty"
                    else:
                        result = "failed"

                    report[result] += [{"query": download_url, "result": response.text}]
                    warnings.warn(f"Failed to download {download_url}\n{response.text}")
                    print("Failed")
                    continue

                report = data_download_transform(
                    response,
                    output_file_path,
                    json_query["user_query"]["response"],
                    polygon_region,
                    report,
                )

    return report
