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

    # Reasons a dataset ends up in the zip vs. gets left out. Anything not
    # COMPLETED/PARTIAL didn't make it in — surface it to the user.
    _INCLUDED = ("COMPLETED", "PARTIAL")
    _MISS_REASON = {
        "FAILED": "could not be retrieved from its source",
        "EMPTY": "had no data matching your selection",
        "IGNORED": "was skipped because the download size limit was reached",
    }
    _MISS_REASON_FR = {
        "FAILED": "n'a pas pu être récupéré depuis sa source",
        "EMPTY": "ne contenait aucune donnée correspondant à votre sélection",
        "IGNORED": "a été ignoré car la limite de taille de téléchargement a été atteinte",
    }

    dataset_urls = []
    failed_datasets = []
    if downloader_output:
        for dataset in downloader_output["erddap_report"]:
            # OBIS datasets aren't on an ERDDAP server (erddap_url is the
            # https://obis.org sentinel), so the /info/<id>/index.html ERDDAP
            # path doesn't exist for them — link to the OBIS dataset page.
            is_obis = "obis.org" in (dataset.get("erddap_url") or "")
            if is_obis:
                source_label = "OBIS"
                source_url = "https://obis.org/dataset/" + dataset["dataset_id"]
            else:
                source_label = "ERDDAP"
                source_url = (
                    dataset["erddap_url"] + "/info/" + dataset["dataset_id"] + "/index.html"
                )

            if dataset.get("status") not in _INCLUDED:
                failed_datasets += [{
                    "dataset_id": dataset["dataset_id"],
                    "reason": _MISS_REASON.get(
                        dataset.get("status"), "could not be included"
                    ),
                    "reason_fr": _MISS_REASON_FR.get(
                        dataset.get("status"), "n'a pas pu être inclus"
                    ),
                }]
                # Don't cite a dataset that isn't in the zip.
                continue

            out = {"source_label": source_label, "source_url": source_url}
            if dataset["ckan_id"]:
                out["ckan_url"] = (
                    "https://catalogue.cioos.ca/dataset/" + dataset["ckan_id"]
                )

            dataset_urls += [out]

    # Join with a single "/" — DOWNLOAD_WAF_URL has no trailing slash (compose
    # sets "<domain>/downloads"), so plain concatenation produced
    # ".../downloadscde_download_xxx.zip".
    download_url = envs["DOWNLOAD_WAF_URL"].rstrip("/") + "/" + zip_filename

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
                dataset_urls=dataset_urls,
                download_url=download_url,
                status=status,
                failed_datasets=failed_datasets,
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

    # Returned so run_download_observed can decide the Prefect run's state. The
    # row and the user's email are already written by this point; this is only
    # the outcome label.
    return status


def fail_job(pk, error):
    """
    Mark a job failed after an error escaped run_download, so it doesn't sit in
    'downloading' forever with the user waiting on an email that never comes.
    """
    update_download_jobs(
        pk,
        {
            "status": "failed",
            # SQLAlchemy struggles with '%
            "downloader_output": str(error).replace("%", "").replace("'", ""),
            "time_complete": "NOW()",
        },
    )


# --- Prefect observability ---------------------------------------------------
# Each download runs as its own Prefect flow run, so the queue is visible in the
# same UI as the harvests — per-job state, duration and log lines — instead of
# only a status column in cde.download_jobs that someone has to query by hand.
#
# Opt-in via PREFECT_API_URL, which compose sets for the scheduler service. With
# it unset (a bare local run, or a deployment with no Prefect server) Prefect
# would quietly stand up its own ephemeral backing store and record runs where
# nobody is looking, so skip the wrapper and behave exactly as before.
DOWNLOAD_FLOW_NAME = "Download Job"

# Outcomes of run_download that should show as a FAILED flow run. no-data and
# over-limit are ordinary results the user is emailed about, not faults.
FAILED_STATUSES = frozenset({"failed"})


class DownloadJobFailed(Exception):
    """Carries a failed download into Prefect as a failed flow run.

    Raised inside the flow body only, and swallowed by run_download_observed:
    run_download has already written the status and emailed the user, so this
    must not reach process_next_job, which would mark the job failed a second
    time and overwrite that status with this traceback.
    """


def _prefect_enabled():
    return bool(os.environ.get("PREFECT_API_URL"))


def _mirror_logs_to_prefect():
    """Forward loguru output to the active Prefect run logger; returns the sink id.

    Without this a download's flow run has no logs at all: the scheduler and the
    downloader both log through loguru, which Prefect knows nothing about
    (PREFECT_LOGGING_EXTRA_LOGGERS only reaches stdlib loggers). Returns None
    outside a run context, so the caller knows there is no sink to remove.
    """
    from prefect import get_run_logger

    try:
        run_logger = get_run_logger()
    except Exception:
        return None

    def sink(message):
        record = message.record
        # loguru's level numbers match the stdlib ones (DEBUG 10 ... CRITICAL 50).
        run_logger.log(record["level"].no, record["message"])

    return logger.add(sink, level="INFO")


def run_download_observed(row):
    """Run one claimed job, as a Prefect flow run when Prefect is configured."""
    if not _prefect_enabled():
        run_download(row)
        return

    from prefect import flow

    # Declared per job so the run can be named after it, while the flow NAME
    # stays constant so Prefect still groups every download under one flow.
    # Deliberately parameterless: `row` is a SQLAlchemy RowMapping, which is not
    # a serializable Prefect parameter, and its identity is already in the name.
    @flow(name=DOWNLOAD_FLOW_NAME, flow_run_name=f"download-{row['job_id']}")
    def download_job():
        sink_id = _mirror_logs_to_prefect()
        try:
            status = run_download(row)
        finally:
            # Per-job sink: leaving it attached would stack one dead run logger
            # per download and mirror every later job into all of them.
            if sink_id is not None:
                logger.remove(sink_id)
        if status in FAILED_STATUSES:
            raise DownloadJobFailed(
                f"download job {row['job_id']} finished as '{status}'"
            )
        return status

    try:
        download_job()
    except DownloadJobFailed as e:
        # The red flow run is the point; the job row and email are already done.
        logger.info("{}", e)


def process_next_job():
    """
    Claim and run the next queued job.

    Returns True when the queue is being served (a job ran, or there was
    nothing to do) and False when the job could not even be claimed, so the
    caller can back off instead of spinning against a database that is down.

    Errors are contained here deliberately. Nothing supervises this worker, so
    an exception that escapes the polling loop kills it silently and leaves
    every later download queued forever with no error surfaced to anyone.
    """
    try:
        row = get_a_download_job()
    except Exception:
        logger.exception("Could not claim a download job")
        return False

    if row is None:
        return True

    try:
        run_download_observed(row)
    except Exception:
        # run_download handles downloader failures itself; reaching here means
        # something outside that (a malformed job row, a template or mail
        # error) broke, and the job is still marked 'downloading'.
        logger.exception("Unhandled error running job {}", row["pk"])
        try:
            fail_job(row["pk"], traceback.format_exc())
        except Exception:
            logger.exception("Could not mark job {} as failed", row["pk"])

    return True


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
