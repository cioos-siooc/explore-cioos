# from sqlalchemy import JSON, Text
import json
import logging
import os
import pathlib
import traceback

import sentry_sdk
from dotenv import load_dotenv
from sentry_sdk.integrations.loguru import LoguruIntegration
from cde_harvester.core.issues import error_signature, report_issues
from erddap_downloader import downloader_wrapper
from jinja2 import Environment, FileSystemLoader
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from loguru import logger

from download_scheduler.download_email import send_email

this_directory = pathlib.Path(__file__).parent.absolute()
schema_path = os.path.join(this_directory, "templates")

template_loader = FileSystemLoader(searchpath=schema_path)
template_env = Environment(loader=template_loader)

# check if docker has set env variables, if not load from .env
envs = os.environ

if not os.getenv("DB_HOST"):
    load_dotenv(os.getcwd() + "/.env")

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[
        # Log records become breadcrumbs only. Turning every ERROR into its own
        # event meant an alert per failed job; failures are now reported grouped
        # by the error itself (see cde_harvester.core.issues) and de-duped by
        # Sentry, so a known-broken server stops re-alerting on every run.
        LoguruIntegration(level=logging.INFO, event_level=None),
    ],
    environment=os.environ.get("ENVIRONMENT", "development"),
    traces_sample_rate=1.0,
    ignore_errors=[KeyboardInterrupt],
)


database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
logger.debug("Connecting to", envs["DB_HOST"])
engine = create_engine(database_link)

create_pdf = False

# In production, this is mapped to a WAF via a host mounted volume
output_folder = "./downloads"


if "CREATE_PDF" in envs:
    create_pdf = envs["CREATE_PDF"] == "True"
    logger.info("Create PDFs:", create_pdf)


def get_a_download_job():
    """
    Get the oldest download job in the download_jobs table, return the row
    """
    session = Session(engine)

    rs = session.execute(
        text(
            "SELECT * FROM cde.download_jobs WHERE status='open' ORDER BY time ASC LIMIT 1 FOR UPDATE SKIP LOCKED"
        )
    )
    # .mappings() so columns remain accessible by name (row["pk"]) under SQLAlchemy 2.0
    row = rs.mappings().fetchone()

    if row:
        pk = row["pk"]
        job_id = row["job_id"]
        logger.info("Starting job:", pk, job_id)
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
            "fr": "Votre requête à l'Explorateur de Données du SIOOC fût complétée avec succès.",
        },
        "over-limit": {
            "en": "Your CIOOS Data Explorer data query completed but found too much data.",
            "fr": "Votre requête à l'Explorateur de Données du SIOOC est terminée mais a atteint la limite de téléchargement.",
        },
        "no-data": {
            "en": "Your CIOOS Data Explorer data query failed.",
            "fr": "La requête de données à l'Explorateur de Données du SIOOC a échoué.",
        },
        "failed": {
            "en": "Your CIOOS Data Explorer data query failed.",
            "fr": "La requête de données à l'Explorateur de Données du SIOOC a échoué.",
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
        logger.bind(
            email=email,
            job_id=user_query["job_id"],
            pk=pk,
        ).error(e)
        # Log records no longer become Sentry events, so report the crash
        # explicitly. Fingerprinting on the normalized exception text groups
        # every job that fails the same way into one issue instead of one per job.
        with sentry_sdk.new_scope() as scope:
            scope.fingerprint = [
                "downloader", "job-failed", error_signature(f"{type(e).__name__}: {e}")
            ]
            scope.set_tag("component", "downloader")
            scope.set_context("job", {"job_id": user_query["job_id"], "pk": pk})
            sentry_sdk.capture_exception(e)

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

        # Datasets that failed inside an otherwise-successful job are invisible
        # in the job status; surface them grouped by the error each server
        # actually returned. FAILED is the only status that is a real problem —
        # EMPTY/IGNORED/PARTIAL are outcomes the user is told about by email.
        report_issues(
            "downloader",
            [
                {**dataset, "status": "error", "error_message": dataset.get("erddap_error")}
                for dataset in downloader_output.get("erddap_report", [])
                if dataset.get("status") == "FAILED"
            ],
            logger,
        )

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


def update_download_jobs(pk, row, session=None):
    params = ",".join([f"{key}='{value}'" for key, value in row.items()])
    sql = f"UPDATE cde.download_jobs SET {params} WHERE PK={pk}"
    if session is not None:
        # Caller owns the transaction/commit (see get_a_download_job).
        session.execute(text(sql))
    else:
        # SQLAlchemy 2.0 removed Engine.execute(); run in an auto-committing
        # transaction via engine.begin().
        with engine.begin() as conn:
            conn.execute(text(sql))
