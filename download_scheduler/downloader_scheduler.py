import configparser
# from sqlalchemy import JSON, Text
import json
import time
from re import L

from erddap_downloader import downloader_wrapper
from sqlalchemy import create_engine

config = configparser.ConfigParser()
config.read(".env")
db = config["db"]

data_base_link = (
    f"postgresql://{db['user']}:{db['password']}@{db['host']}:5432/{db['database']}"
)

engine = create_engine(data_base_link)

output_folder = "./out/"
create_pdf = False


def get_a_download_job():
    """
    :return: Latest timestamp avaiable on the CIOOS Bayne Sound database
    """

    rs = engine.execute(
        "SELECT * FROM cioos_api.download_jobs WHERE status='open' ORDER BY time ASC LIMIT 1"
    )
    return rs.fetchone()


def run_download(row):
    pk = row["pk"]

    # Update status
    update_download_jobs(pk, {"status": "downloading"})

    # Run Download
    try:
        downloader_input = json.loads(row["downloader_input"])
        print(downloader_input)
        # Run query in parallel mode
        result = downloader_wrapper.parallel_downloader(
            json_blob=downloader_input,
            output_folder=output_folder,
            create_pdf=create_pdf,
        )

        # Download Completed Update Status
        update_download_jobs(
            pk, {"status": "completed", "downloader_output": str(result)}
        )

    except Exception as e:
        update_download_jobs(pk, {"status": "failed", "downloader_output": str(e)})
        print(e)


def update_download_jobs(pk, row):
    for key, value in row.items():
        engine.execute(
            f"UPDATE cioos_api.download_jobs SET {key}='{value}' WHERE PK={pk}"
        )


if __name__ == "__main__":
    while True:
        row = get_a_download_job()

        if row:
            print("Starting job:", row["pk"])
            run_download(row)
        else:
            print("No jobs")

        time.sleep(2)
