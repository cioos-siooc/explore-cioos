# from sqlalchemy import JSON, Text
import json
import os
import traceback
from re import L

import sentry_sdk
from dotenv import load_dotenv
from download_scheduler.download_email import send_email
from erddap_downloader import downloader_wrapper
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

# check if docker has set env variables, if not load from .env
envs = os.environ

if not os.getenv("DB_HOST"):
    load_dotenv(os.getcwd() + "/.env")

if envs["ENVIRONMENT"] == "production":
    ignore_errors = [KeyboardInterrupt]

    sentry_sdk.init(
        "https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595",
        # Set traces_sample_rate to 1.0 to capture 100%
        # of transactions for performance monitoring.
        # We recommend adjusting this value in production.
        traces_sample_rate=1.0,
        ignore_errors=ignore_errors,
    )


database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
print("Connecting to", envs["DB_HOST"])
engine = create_engine(database_link)

create_pdf = False

# In production, this is mapped to a WAF via a host mounted volume
output_folder = "./downloads"


if "CREATE_PDF" in envs:
    create_pdf = envs["CREATE_PDF"] == "True"
    print("Create PDFs:", create_pdf)


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
        update_download_jobs(
            pk, {"status": "downloading", "time_start": "NOW()"}, session
        )
    session.commit()
    return row


def email_user(email, status, zip_filename):
    """
    Send the user a success/failed message
    """

    download_url = envs["DOWNLOAD_WAF_URL"] + zip_filename
    messages = {
        "completed": {
            "subject": "Your CDE data query was successful",
            "body": f"Your CDE download is available at {download_url}",
        },
        "over-limit": {
            "subject": "Your CDE data query completed but found too much data.",
            "body": f"Your CDE download is available at {download_url}. It has been cut off to return less data. If needed, please try again with a smaller polygon or fewer filters.",
        },
        "no-data": {
            "subject": "Your CDE data query was successful",
            "body": f"Your CDE query didn't find any data.  Please try again with a larger polygon or different filters",
        },
        "failed": {
            "subject": "Your CDE data query failed",
            "body": f"Your CDE download failed. We are aware of the failed query and are working to resolve it",
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
    zip_filename = "cde_download_" + user_query["job_id"] + ".zip"
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
        print(stack_trace)
        sentry_sdk.capture_message(f"download by {email} failed")

    # The downloader crashed and returned a string (error message) instead of json
    if downloader_error:
        update_download_jobs(
            pk,
            {
                "status": status,
                "downloader_output": str(downloader_error)
                .replace("%", "")
                .replace("'", ""),
                "time_complete": "NOW()",
            },
        )
    else:
        # these probably dont both need to be here
        if downloader_output.get("zip_file_size") == 0 or downloader_output.get(
            "empty_download"
        ):
            status = "no-data"

        if downloader_output.get("over_limit"):
            status = "over-limit"

        update = {
            "status": status,
            # clear downloader_output in case it was an error before and now works
            "downloader_output": "",
            # SQLAlchemy struggles with '%
            "erddap_report": json.dumps(downloader_output)
            .replace("%", "")
            .replace("'", ""),
            "time_complete": "NOW()",
            "download_size": str(downloader_output.get("total_size")),
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
