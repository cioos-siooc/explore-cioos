import pandas as pd

from erddap_downloader import downloader_wrapper

import configparser
from sqlalchemy import create_engine
from sqlalchemy import JSON, Text

import json
import argparse

import os
import sys
import warnings


config = configparser.ConfigParser()
config.read(".env")
db = config["db"]

data_base_link = (
    f"postgresql://{db['user']}:{db['password']}@{db['host']}:5432/{db['database']}"
)

engine = create_engine(data_base_link)
s
table_type = {
    "downloader_input": JSON,
    "downloader_output": Text,
    "status": Text,
}

output_folder = '/out/'
create_pdf = True

def get_download_jobs():
    """
    :return: Latest timestamp avaiable on the CIOOS Bayne Sound database
    """
    df = pd.read_sql_table(db["table"], con=engine, schema=db["schema"])
    if isinstance(df, pd.DataFrame):
        return df
    else:
        return None


def update_download_jobs(df):
    df.to_sql(
        name=db["table"],
        schema=db["schema"],
        if_exists="replace",
        index=False,
        con=engine,
        dtype=table_type,
    )


def run_download(row):
    # Update status
    row["status"] = "active"
    update_download_jobs(row)

    # Run Download
    try:
        with open(row['downloader_input']) as fid:
            json_blob = json.load(fid)

            # Run query in parallel mode
        downloader_wrapper.parallel_downloader(
            json_blob=json_blob, output_folder=output_folder, create_pdf=create_pdf
        )
    except:
        row["status"] = "failed"
        update_download_jobs(row)

    # Download Completed Update Status
    row["status"] = "completed"
    update_download_jobs(row)


if __name__ == "__main__":
    df = get_download_jobs()

    df_open = df[df["status"] == "open"]
    for index, row in df_open.iterrows():
        run_download(row)

    df["status"] = "test"

    table_type = {
        "downloader_input": JSON,
        "downloader_output": Text,
        "status": Text,
    }
