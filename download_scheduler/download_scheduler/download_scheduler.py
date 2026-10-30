import json
import logging
import os
import pathlib
import time
import traceback

import sentry_sdk
from cde_harvester.core.issues import error_signature, report_issues
from cioos_downloader import downloader_wrapper
from cioos_downloader.download_erddap import FORMATS
from cioos_downloader.package import REASONS
from dotenv import load_dotenv
from jinja2 import Environment, FileSystemLoader
from loguru import logger
from sentry_sdk.integrations.loguru import LoguruIntegration
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from download_scheduler.download_email import send_email

this_directory = pathlib.Path(__file__).parent.absolute()
schema_path = os.path.join(this_directory, "templates")

template_loader = FileSystemLoader(searchpath=schema_path)
template_env = Environment(loader=template_loader)

envs = os.environ

if not os.getenv("DB_HOST"):
    load_dotenv(os.getcwd() + "/.env")

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[
        # Log records become breadcrumbs only, so failures are reported once,
        # grouped by error (see run_download) instead of one alert per job.
        LoguruIntegration(level=logging.INFO, event_level=None),
    ],
    environment=os.environ.get("ENVIRONMENT", "development"),
    traces_sample_rate=1.0,
    ignore_errors=[KeyboardInterrupt],
)


database_link = (
    f"postgresql+psycopg2://{envs['DB_USER']}:{envs['DB_PASSWORD']}"
    f"@{envs['DB_HOST']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
)
logger.debug("Connecting to {}", envs["DB_HOST"])
engine = create_engine(database_link)

# Sentinel for update_download_jobs: the column takes the database's NOW(),
# not a bound value. Compared by identity, so a job that literally stores the
# string "NOW()" in a text column is unaffected.
SQL_NOW = "NOW()"

# In production, this is mapped to a WAF via a host mounted volume
output_folder = "./downloads"
# Touched after every served poll. The container HEALTHCHECK reads its age, and
# nginx serves it at /downloads/healthz, which proves the volume is shared.
heartbeat_file = pathlib.Path(output_folder) / "healthz"


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
        logger.info("Starting job: pk={} job_id={}", pk, job_id)
        update_download_jobs(
            pk, {"status": "downloading", "time_start": SQL_NOW}, session
        )
    session.commit()
    return row


def email_user(email, status, zip_filename, downloader_output, language):
    """
    Send the user a success/failed message
    """

    # Anything not COMPLETED/PARTIAL didn't make it into the zip.
    _INCLUDED = ("COMPLETED", "PARTIAL")

    dataset_urls = []
    failed_datasets = []
    fallback_datasets = []
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

            title = dataset.get("title")
            label = f"{title} ({dataset['dataset_id']})" if title else dataset["dataset_id"]
            if dataset.get("status") not in _INCLUDED:
                failed_datasets += [{
                    "dataset_id": label,
                    "reason": REASONS["en"].get(dataset.get("status"), "could not be included"),
                    "reason_fr": REASONS["fr"].get(dataset.get("status"), "n'a pas pu être inclus"),
                    # The server's own words; the README has the full text and URLs.
                    "error": (dataset.get("erddap_error") or "").replace("\n", "; ")[:300],
                }]
                # Don't cite a dataset that isn't in the zip.
                continue

            if dataset.get("format_fallback"):
                requested = FORMATS[dataset["requested_format"]].label
                fallback_datasets += [{
                    "dataset_id": label,
                    "reason": REASONS["en"]["fallback"].format(format=requested),
                    "reason_fr": REASONS["fr"]["fallback"].format(format=requested),
                }]

            out = {"source_label": source_label, "source_url": source_url}
            if dataset["ckan_id"]:
                out["ckan_url"] = (
                    "https://catalogue.cioos.ca/dataset/" + dataset["ckan_id"]
                )

            dataset_urls += [out]

    # DOWNLOAD_WAF_URL may lack a trailing slash.
    download_url = envs["DOWNLOAD_WAF_URL"].rstrip("/") + "/" + zip_filename

    email_subject = {
        "completed": {
            "en": "Your CIOOS Data Explorer query was successful",
            "fr": "Votre requête à l'Explorateur de Données du SIOOC fût complétée avec succès.",
        },
        "over-limit": {
            "en": "Your CIOOS Data Explorer data query completed but found too much data.",
            "fr": (
                "Votre requête à l'Explorateur de Données du SIOOC est terminée "
                "mais a atteint la limite de téléchargement."
            ),
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

    template_name = "completed" if status == "over-limit" else status

    language_list = ["en", "fr"] if language == "en" else ["fr", "en"]

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
                fallback_datasets=fallback_datasets,
                retention_days=DOWNLOAD_RETENTION_DAYS,
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

    status = ""
    zip_filename = None
    downloader_input = json.loads(row["downloader_input"])
    user_query = downloader_input["user_query"]

    email = user_query["email"]
    zip_filename = "cde_download_" + user_query["job_id"] + ".zip"
    downloader_output = ""
    downloader_error = ""

    try:
        downloader_output = downloader_wrapper.run_download_query(
            download_query=downloader_input,
            output_folder=output_folder,
        )

        status = "completed"

    except Exception as e:
        status = "failed"
        downloader_error = traceback.format_exc()
        logger.bind(
            email=email,
            job_id=user_query["job_id"],
            pk=pk,
        ).error(e)
        # Fingerprinting on the normalized exception text groups every job that
        # fails the same way into one Sentry issue.
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
                "downloader_output": downloader_error,
                "time_complete": SQL_NOW,
            },
        )
    else:
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
            "erddap_report": json.dumps(downloader_output),
            "time_complete": SQL_NOW,
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
            "downloader_output": str(error),
            "time_complete": SQL_NOW,
        },
    )


# Each download runs as its own Prefect flow run. Opt-in via PREFECT_API_URL:
# unset, Prefect would quietly stand up an ephemeral store nobody looks at.
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

    PREFECT_LOGGING_EXTRA_LOGGERS only reaches stdlib loggers, not loguru.
    Returns None outside a run context.
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

    Errors are contained here deliberately: nothing supervises this worker, so
    an escaped exception would silently leave every later download queued.
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


def poll_once():
    """process_next_job, plus the heartbeat when the queue is being served."""
    serving = process_next_job()
    if serving:
        heartbeat_file.parent.mkdir(parents=True, exist_ok=True)
        heartbeat_file.touch()
    return serving


# The privacy notice promises 7 days of email retention after a job finishes;
# queued/running jobs keep theirs because run_download emails the result. The
# domain stays for usage statistics.
FORGET_EMAILS_SQL = text(
    """
    UPDATE cde.download_jobs
    SET email = NULL,
        email_domain = COALESCE(email_domain, lower(split_part(email, '@', 2))),
        downloader_input = (downloader_input::jsonb #- '{user_query,email}')::text
    WHERE email IS NOT NULL
      AND status NOT IN ('open', 'downloading')
      AND COALESCE(time_complete, time) < NOW() - INTERVAL '7 days'
    """
)


def forget_expired_emails():
    """Clear the email from finished jobs past retention; never raises."""
    try:
        with engine.begin() as conn:
            forgotten = conn.execute(FORGET_EMAILS_SQL).rowcount
    except Exception:
        logger.exception("Could not clear expired download emails")
        sentry_sdk.capture_exception()
        return
    if forgotten:
        logger.info("Cleared the email from {} expired download jobs", forgotten)


# The email and the Download modal (downloadEmailNotice) state this lifetime.
DOWNLOAD_RETENTION_DAYS = 7


def delete_expired_downloads():
    """Delete download zips past retention; never raises."""
    cutoff = time.time() - DOWNLOAD_RETENTION_DAYS * 24 * 60 * 60
    deleted = 0
    try:
        for path in pathlib.Path(output_folder).glob("cde_download_*.zip"):
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                deleted += 1
    except OSError:
        logger.exception("Could not delete expired downloads")
        sentry_sdk.capture_exception()
    if deleted:
        logger.info("Deleted {} expired downloads", deleted)


def update_download_jobs(pk, row, session=None):
    """Update one download_jobs row. Values are bound, never interpolated.

    Column names come from the literals in this module, so they are safe to
    format into the statement; values carry tracebacks and JSON reports.
    """
    assignments = []
    params = {"pk": pk}
    for key, value in row.items():
        if value is SQL_NOW:
            assignments.append(f"{key} = NOW()")
        else:
            assignments.append(f"{key} = :{key}")
            params[key] = value

    sql = f"UPDATE cde.download_jobs SET {', '.join(assignments)} WHERE pk = :pk"
    if session is not None:
        # Caller owns the transaction/commit (see get_a_download_job).
        session.execute(text(sql), params)
    else:
        with engine.begin() as conn:
            conn.execute(text(sql), params)
