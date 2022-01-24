import argparse
import json
import os
import warnings

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from erddap_scraper.utils import eov_to_standard_names
from sqlalchemy import create_engine

envs = os.environ

if not os.getenv("DB_HOST"):
    load_dotenv(os.getcwd() + "/.env")

database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"

engine = create_engine(database_link)
engine.connect()

schema = "cioos_api"


header_size_per_var = 18
data_type_size = {
    "String": 8,
    "default": 8,
}


def query_profiles(query, datasets):
    """
    Query the database for subsets matching the query generated by CEDA interface
    """
    # Generate Query to database
    sql_query = f"""
    SELECT * FROM {schema}.profiles WHERE(
        ST_Contains(ST_GeomFromText('{query['polygon_region']}',4326),ST_Transform(geom,4326)) is true AND
        (erddap_url,dataset_id) in ({",".join(f"('{x['erddap_url']}','{x['dataset_id']}')" for x in datasets)}) AND
        time_min<'{query['time_max']}' AND 
        time_max>'{query['time_min']}' AND
        (  
            (depth_min<={query['depth_max']} AND  
            depth_max>={query['depth_min'] if query['depth_min'] else 0}) 
            OR depth_min IS {'NOT'if query['depth_min'] else ''} NULL
        )
    )"""

    # Retrieve query result
    return pd.read_sql(sql_query, con=engine, index_col="pk")


def estimate_n_record_per_profile(profiles, query):
    """
    Estimate the amount of records expected based on the
    record count and record density along and z variables.
    """

    # Convert time variables to datetime
    for time_var in ["time_min", "time_max"]:
        profiles[time_var] = pd.to_datetime(profiles[time_var], utc=True)

    # Derive Profiles Densities
    dz = profiles["depth_max"] - profiles["depth_min"]
    dt = (profiles["time_max"] - profiles["time_min"]).dt.days
    profiles["rec_per_day"] = profiles["n_profiles"] / dt.where(dt > 0, np.nan).fillna(
        profiles["n_records"] / dt.where(dt > 0, np.nan)
    )
    profiles["rec_per_m_vert"] = (
        profiles["n_records"] / profiles["n_profiles"]
    ) / dz.where(dz > 0, np.nan)

    # Reduce limits to the narrowest between the query and subset limits
    time_min = profiles["time_min"].where(
        profiles["time_min"] > query["time_min"], query["time_min"]
    )
    time_max = profiles["time_max"].where(
        profiles["time_max"] < query["time_max"], query["time_max"]
    )
    depth_min = profiles["depth_min"].where(
        profiles["depth_min"] > query["depth_min"], query["depth_min"]
    )
    depth_max = profiles["depth_max"].where(
        profiles["depth_max"] < query["depth_max"], query["depth_max"]
    )

    # Estimate amount of records expected
    # First estimate vertical records expected then horizontal and multiply both
    z_records = (depth_max - depth_min) * profiles["rec_per_m_vert"]
    t_records = (time_max - time_min).dt.days * profiles["rec_per_day"]
    profiles["estimated_n_records"] = (
        (z_records * t_records).fillna(z_records).fillna(t_records)
    )
    return profiles


def estimate_query_size_per_dataset(query):
    """
    General wrapper that interact with the different components to estimate a query download size.
    """
    # Regroup by dataset
    profiles = query_profiles(query["user_query"], query["cache_filtered"])

    # Estimate records per profiles
    profiles = estimate_n_record_per_profile(profiles, query["user_query"])

    # Sum all subsets records by datasets
    datasets = (
        profiles.groupby(["erddap_url", "dataset_id"])["estimated_n_records"]
        .sum()
        .to_frame()
    )

    # Get download_size per dataset
    datasets["bytes_size"] = get_dataset_size(datasets, query["user_query"]["eovs"])

    # Get string based on estimated size
    datasets["download_size_string"] = datasets["bytes_size"].apply(
        dataset_size_estimation_string
    )
    return datasets


def standard_name_from_eovs(eovs: list):
    """
    Method use to retrieve the mapping from eovs to downloader available within the downloader package.
    """
    standard_names = set()
    for eov in eovs:
        if eov in eov_to_standard_names:
            standard_names = standard_names.union(eov_to_standard_names[eov])
        else:
            warnings.warn(f"EOV {eov} is unavailable", UserWarning)
    return standard_names


def get_dataset_size(datasets, standard_name=[""]):
    """
    Method to estimate the download size based on the amount of records and variables expected to download.
    """
    sql_query = f"""
    SELECT erddap_url ,dataset_id ,"type",COUNT("type") FROM {schema}.erddap_variables 
    WHERE  ( 
        (erddap_url,dataset_id) in {'('+str(datasets.index.values[0])+')' if len(datasets.index.values)==1 else tuple(datasets.index.values)}
        AND (
                "name" in ('time','latitude','longitude','depth') 
                OR cf_role is not NULL 
                OR (standard_name in ('{"','".join(standard_name)}')
            )
        )
    )
    GROUP BY (erddap_url,dataset_id,"type")
    """
    # Get variable type count per datasets
    df_count = pd.read_sql(sql_query, con=engine)
    df_count["size_per_type"] = (
        df_count["type"].map(data_type_size).fillna(data_type_size["default"])
    )

    # size per type
    df_count["size"] = df_count["size_per_type"] * df_count["count"]

    # header size
    df_header = df_count.groupby(["erddap_url", "dataset_id"])["count"].sum()

    # Sum the different type of data per record and multiply amount of record and add header size
    return (
        df_count.groupby(["erddap_url", "dataset_id"])["size"].sum()
        * datasets["estimated_n_records"]
        + df_header
    )


def dataset_size_estimation_string(byte_size):
    """
    Method use to convert an estimated download byte size to a approximative MB size in string format
    """
    if byte_size < 100000:
        return "< 0.1MB"
    decimal = np.floor(np.log10(byte_size))
    factor = np.power(10, decimal)
    return f"> {np.floor(byte_size/factor)*factor/1E6}MB"


def estimate_query_size_per_dataset(query):
    """
    General method that interact with the different components to estimate a query download size.
    """

    # Regroup by dataset
    profiles = query_profiles(query["user_query"], query["cache_filtered"])

    # If no profiles exists for such query just return an empty dataframe
    if profiles.empty:
        warnings.warn("No data available", UserWarning)
        return profiles

    # Estimate records per profiles
    profiles = estimate_n_record_per_profile(profiles, query["user_query"])

    # Sum all subsets records by datasets
    datasets = (
        profiles.groupby(["erddap_url", "dataset_id"])["estimated_n_records"]
        .sum()
        .to_frame()
    )

    # Get download_size per dataset
    standard_names = standard_name_from_eovs(query["user_query"]["eovs"])
    datasets["bytes_size"] = get_dataset_size(datasets, standard_names)

    # Get string based on estimated size
    datasets["download_size_string"] = datasets["bytes_size"].apply(
        dataset_size_estimation_string
    )
    return datasets


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("query")
    args = parser.parse_args()

    # Read json file or json string
    if args.query.endswith(".json"):
        with open(args.query) as f:
            query = json.load(f)
    else:
        query = json.loads(args.query)

    df_estimated = estimate_query_size_per_dataset(query)
    print(df_estimated)
