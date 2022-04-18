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

from jinja2 import Environment, PackageLoader, select_autoescape, FileSystemLoader
import pathlib

this_directory = pathlib.Path(__file__).parent.absolute()
schema_path = os.path.join(this_directory, "templates")

template_loader = FileSystemLoader(searchpath=schema_path)
template_env = Environment(loader=template_loader)

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


def email_user(email, status, zip_filename, downloader_output, language):
    """
    Send the user a success/failed message
    """

    dataset_urls = []
    if downloader_output:
        for dataset in downloader_output["erddap_report"]:
            erddap_metadata_url = (
                dataset["erddap_url"] + "/info/" + dataset["dataset_id"] + "/index.html"
            )
            out = {}
            out["erddap_metadata_url"] = erddap_metadata_url

            if dataset["ckan_id"]:
                out["ckan_url"] = (
                    "https://catalogue.cioos.ca/dataset/" + dataset["ckan_id"]
                )

            dataset_urls += [out]

    download_url = envs["DOWNLOAD_WAF_URL"] + zip_filename

    email_subject = {
        "completed": {
            "en": "Your CIOOS Data Explorer query was successful",
            "fr": "Votre requête dans l'Explorateur de données du CIOOS a réussi",
        },
        "over-limit": {
            "en": "Your CIOOS Data Explorer data query completed but found too much data.",
            "fr": "Votre requête de données CIOOS Data Explorer est terminée mais a trouvé trop de données.",
        },
        "no-data": {
            "en": "Your CIOOS Data Explorer data query failed.",
            "fr": "La requête de données de l'Explorateur de données CIOOS a échoué.",
        },
        "failed": {
            "en": "Your CIOOS Data Explorer data query failed.",
            "fr": "La requête de données de l'Explorateur de données CIOOS a échoué.",
        },
    }

    if status == "over-limit":
        template_name = "completed"
    else:
        template_name = status

    if language == "en":
        language_list = ["en", "fr"]
    else:
        language_list = ["fr", "en"]

    subject = []
    body = []

    for language_option in language_list:
        template = template_env.get_template(f"{template_name}-{language_option}.j2")

        body += [
            template.render(
                dataset_urls=dataset_urls, download_url=download_url, status=status
            )
        ]
        subject += [email_subject[status][language_option]]

    template = template_env.get_template("footer.j2")
    footer = template.render()

    language_divider = "\n\n================================\n\n"
    body_text = language_divider.join(body) + footer
    subject_text = " / ".join(subject)

    send_email(email, body_text, subject_text)


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

    email_user(
        email,
        status,
        zip_filename,
        downloader_output,
        downloader_input["user_query"]["language"],
    )


def update_download_jobs(pk, row, session=engine):
    params = ",".join([f"{key}='{value}'" for key, value in row.items()])
    sql = f"UPDATE cioos_api.download_jobs SET {params} WHERE PK={pk}"
    session.execute(sql)
