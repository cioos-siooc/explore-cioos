import configparser

# from sqlalchemy import JSON, Text
import json
import time
import traceback
from re import L

from erddap_downloader import downloader_wrapper
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from download_email import send_email

import sentry_sdk

config = configparser.ConfigParser()
config.read(".env")
db = config["db"]
scheduler_config = config["config"]


if scheduler_config.get("environment") == "production":
    ignore_errors = [KeyboardInterrupt]

    sentry_sdk.init(
        "https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595",
        # Set traces_sample_rate to 1.0 to capture 100%
        # of transactions for performance monitoring.
        # We recommend adjusting this value in production.
        traces_sample_rate=1.0,
        ignore_errors=ignore_errors,
    )


data_base_link = (
    f"postgresql://{db['user']}:{db['password']}@{db['host']}:5432/{db['database']}"
)

engine = create_engine(data_base_link)

create_pdf = False
output_folder = "./out"

if "create_pdf" in scheduler_config:
    create_pdf = scheduler_config["create_pdf"] == "True"

if "output_folder" in scheduler_config:
    output_folder = scheduler_config["output_folder"]


def get_a_download_job():
    """
    Get the oldest download job in the download_jobs table, return the row
    """
    session = Session(engine)

    rs = session.execute(
        "SELECT * FROM cioos_api.download_jobs WHERE status='open' ORDER BY time ASC LIMIT 1 FOR UPDATE SKIP LOCKED"
    )
    row = rs.fetchone()

    if row:
        pk = row["pk"]
        print("Starting job:", pk)
        update_download_jobs(pk, {"status": "downloading", "time": "NOW()"}, session)
    session.commit()
    return row


def email_user(email, status, zip_filename):
    """
    Send the user a success/failed message
    """

    download_url = "https://pac-dev2.cioos.org/images/ceda/" + zip_filename
    messages = {
        "completed": {
            "subject": "Your CEDA data query was successful",
            "body": f"Your CEDA download is available at {download_url}",
        },
        "over-limit": {
            "subject": "Your CEDA data query was successful",
            "body": f"Your CEDA download is available at {download_url}",
        },
        "no-data": {
            "subject": "Your CEDA data query was successful",
            "body": f"Your CEDA query didn't find any data.  Please try again with a larger polygon or different filters",
        },
        "failed": {
            "subject": "Your CEDA data query failed",
            "body": f"Your CEDA download failed. We are aware of the failed query and are working to resolve it",
        },
    }

    send_email(email, messages[status]["body"], messages[status]["subject"])


def run_download(row):
    pk = row["pk"]

    # Update status
    status = ""
    zip_filename = None
    # Run Download
    downloader_input = json.loads(row["downloader_input"])
    user_query = downloader_input["user_query"]

    email = user_query["email"]
    zip_filename = user_query["zip_filename"]
    downloader_output = ""
    downloader_error = ""

    try:
        # Run download
        downloader_output = downloader_wrapper.run_download_query(
            download_query=downloader_input,
            output_folder=output_folder,
            create_pdf=create_pdf,
        )
        # Download Completed. Update Status
        status = "completed"

    except Exception as e:
        status = "failed"
        stack_trace = traceback.format_exc()
        downloader_error = str(stack_trace).replace("'", "")
        print(e)
        sentry_sdk.capture_message(f"download by {email} failed")

    # The downloader crashed and returned a string (error message) instead of json
    if downloader_error:
        update_download_jobs(
            pk,
            {
                "status": status,
                "downloader_output": str(downloader_error),
                "time_complete": "NOW()",
            },
        )
    else:
        if downloader_output.get("zip_file_size") == "0":
            status = "no-data"

        if downloader_output.get("over_limit"):
            status = "over-limit"

        update = {
            "status": status,
            # clear downloader_output in case it was an error before and now works
            "downloader_output": "",
            # SQLAlchemy struggles with '%
            "erddap_report": json.dumps(downloader_output.get("erddap_report"))
            .replace("%", "")
            .replace("'", ""),
            "time_complete": "NOW()",
            "download_size": str(downloader_output.get("zip_file_size")),
        }
        update_download_jobs(
            pk,
            update,
        )
    email_user(email, status, zip_filename)


def update_download_jobs(pk, row, session=engine):
    params = ",".join([f"{key}='{value}'" for key, value in row.items()])
    sql = f"UPDATE cioos_api.download_jobs SET {params} WHERE PK={pk}"
    session.execute(sql)


if __name__ == "__main__":
    print("Waiting for jobs..")
    while True:
        row = get_a_download_job()

        if row:
            pk = row["pk"]
            run_download(row)
            print("sleeping")
        time.sleep(0.5)
