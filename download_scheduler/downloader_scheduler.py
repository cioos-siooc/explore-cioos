import configparser
# from sqlalchemy import JSON, Text
import json
import time
import traceback
from re import L

from erddap_downloader import downloader_wrapper
from sqlalchemy import create_engine

from download_email import send_email

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


def email_user(email, status, zip_filename):
    """
    Send the user a success/failed message
    """

    download_url = "https://pac-dev2.cioos.org/images/ceda/" + zip_filename
    subject = "Your CEDA download"
    message = ""
    if status == "completed":
        message = f"Your CEDA download is available at {download_url}"
        subject += " was successful."
    else:
        message = f"Your CEDA download failed. Please try again with a smaller polygon or fewer filters."
        subject += " failed."

    send_email(email, message, subject)


def run_download(row):
    pk = row["pk"]

    # Update status
    update_download_jobs(pk, {"status": "downloading"})
    status = ""
    zip_filename = None
    # Run Download
    downloader_input = json.loads(row["downloader_input"])
    user_query = downloader_input["user_query"]

    email = user_query["email"]
    zip_filename = user_query["zip_filename"]
    downloader_output = ""
    try:
        print("starting download")
        # Run query in parallel mode
        result = downloader_wrapper.parallel_downloader(
            json_blob=downloader_input,
            output_folder=output_folder,
            create_pdf=create_pdf,
        )
        print("download complete")
        status = "completed"
        # Download Completed. Update Status
        downloader_output = str(result)

    except Exception as e:
        status = "failed"
        stack_trace = traceback.format_exc()
        downloader_output = str(stack_trace).replace("'", "")
        print(e)

    update_download_jobs(pk, {"status": status, "downloader_output": downloader_output, "time_complete":"NOW()"})

    email_user(email, status, zip_filename)


def update_download_jobs(pk, row):
    params = ",".join([f"{key}='{value}'" for key, value in row.items()])
    sql = f"UPDATE cioos_api.download_jobs SET {params} WHERE PK={pk}"
    engine.execute(sql)


if __name__ == "__main__":
    while True:
        row = get_a_download_job()

        if row:
            print("Starting job:", row["pk"])
            run_download(row)
        else:
            print("No jobs")

        time.sleep(2)
