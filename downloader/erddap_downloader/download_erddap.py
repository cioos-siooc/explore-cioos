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
    if "polygon_region" in user_constraint:
        (
            user_constraint["lon_min"],
            user_constraint["lat_min"],
            user_constraint["lon_max"],
            user_constraint["lat_max"],
        ) = user_constraint["polygon_object"].bounds

    if (
        "lat_min" in user_constraint
        and "lat_max" in user_constraint
        and "lon_min" in user_constraint
        and "lon_max" in user_constraint
    ):
        e.constraints["latitude>="] = user_constraint["lat_min"]
        e.constraints["latitude<="] = user_constraint["lat_max"]

        e.constraints["longitude>="] = user_constraint["lon_min"]
        e.constraints["longitude<="] = user_constraint["lon_max"]

    # Add variable list to retrieve
    if variables_list:
        e.variables = variables_list

    # Get Download Link
    return e.get_download_url()


def get_file_name_output(dataset_info):
    """
    Generate default file name output to use for each dataset downloaded.
    :param dataset_info: cache dataset info
    :return:
    """
    # Output file is {erddap server}_{dataset_id}_{CKAN_ID}
    output_file_name = "{0}_{1}".format(
        dataset_info["dataset_id"], erddap_server_to_name(dataset_info["erddap_url"])
    )
    return output_file_name


def filter_polygon_region(file_path, polygone):
    """
    ERDDAP is only compatible with a box method to filter lat/long data.
    This present tool reads back the data downloaded and remove any data which is outside the provided polygone.
    It assume that the latitude and longitude data is saved within the corresponding variables.
    :param file_path: path to the file data.
    :param polygone: Polygone region to use
    """

    # Determinate the type of data
    file_type = file_path.split(".")[-1]

    if file_type == "csv":
        # ERDDAP CSV has two lines header, let's read them first
        with open(file_path) as f:
            columns_name = f.readline()
            columns_units = f.readline()
        # Read with pandas
        df = pd.read_csv(
            file_path,
            skiprows=2,
            names=columns_name.split(","),
            float_precision="round_trip",
        )

        # Exclude data outside the polygon
        df = df.loc[
            df.apply(
                lambda x: polygone.contains(Point(x.longitude, x.latitude)), axis=1
            )
        ]

        # Overwrite original file
        with open(file_path + "_test.csv", "w") as f:
            f.write(columns_name)
            f.write(columns_units)
            df.to_csv(f, index=False, header=False, line_terminator="\n")
    else:
        warnings.warn(
            "Polygon filtration is not compatible with {0} format".format(file_type)
        )


def get_dataset(json_query, output_path=""):
    """
    General method use to retrieve erddap datasets from a ceda query.
    :param json_query: JSON CEDA query
    :param output_path: path where to save the downloaded data.
    """
    if "polygon_region" in json_query["user_query"]:
        json_query["user_query"]["polygon_object"] = shapely.wkt.loads(
            json_query["user_query"]["polygon_region"]
        )

    if "response" not in json_query["user_query"]:
        json_query["user_query"]["response"] = "csv"

    for dataset in json_query["cache_filtered"]:
        # Get variable list to download
        variable_list = get_variable_list(
            dataset["erddap_metadata"], json_query["user_query"]["eovs"]
        )

        # Get download url
        download_url = get_erddap_download_url(
            dataset, json_query["user_query"], variable_list
        )

        # Generate the default file name
        output_file_name = get_file_name_output(dataset)
        output_path = os.path.join(output_path, output_file_name)
        output_path += "." + json_query["user_query"]["response"]

        # Download data
        print("Download {0}".format(download_url), end=" ... ")
        r = requests.get(download_url)
        open(output_path, "wb").write(r.content)
        print("Completed")
        # If polygon filter out data outside the polygon
        if "polygon_object" in json_query["user_query"]:
            filter_polygon_region(
                output_path, json_query["user_query"]["polygon_object"]
            )
