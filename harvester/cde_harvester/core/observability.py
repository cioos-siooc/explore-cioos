"""Sentry init and logging helpers shared by the harvest and loading sides."""

import logging
import os
import time
from datetime import datetime
from urllib.parse import urlparse

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

try:
    from prefect import get_run_logger
except Exception:
    get_run_logger = None

_root_logger = logging.getLogger()


def init_sentry():
    """Identical Sentry setup previously inlined in both package __main__ modules.

    Log records become breadcrumbs only (``event_level=None``). Sending every
    WARNING as its own event meant an alert per dataset per run, grouped by log
    message so all servers collapsed together. Dataset failures now arrive via
    ``core.issues.report_issues``, grouped by the error the server actually
    returned and de-duped by Sentry; unhandled exceptions are still captured by
    Sentry's default integrations.
    """
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        integrations=[
            LoggingIntegration(
                level=logging.INFO,  # Capture info and above as breadcrumbs
                event_level=None,  # Don't turn log records into events
            ),
        ],
        environment=os.environ.get("ENVIRONMENT", "development"),
    )


def report_dataset_issue(logger, erddap_url, dataset_id, reason_code, message):
    """Surface a dataset-level problem to the people who can fix it.

    The harvest dashboard is the primary channel — the caller writes the same
    message to cde.harvest_attempts.error_message, next to the query_urls that
    prove it. This adds the Sentry side.

    init_sentry sets event_level=WARNING, so the log call below is already an
    event; what it lacks is grouping. Sentry groups on message text by
    default, and these messages embed per-dataset numbers, so every rejection
    would become its own issue. The tags below group them by server and by
    problem instead, which is the view an operator actually wants.
    """
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("erddap_domain", urlparse(erddap_url).hostname or erddap_url)
            scope.set_tag("dataset_id", dataset_id)
            scope.set_tag("reason_code", reason_code)
            scope.fingerprint = ["dataset-quality", reason_code]
            scope.set_context(
                "dataset", {"erddap_url": erddap_url, "dataset_id": dataset_id}
            )
            logger.warning("Skipping dataset (%s): %s", reason_code, message)
    except Exception:
        # Reporting a skip must never turn that skip into a failed harvest.
        # The dashboard row is written by the caller either way, and it is the
        # channel that matters; Sentry is the convenience copy.
        logger.warning("Skipping dataset (%s): %s", reason_code, message)


def run_logger(fallback=None):
    """Prefect's run logger when inside a flow/task run, else ``fallback``.

    Replaces the try/except-around-get_run_logger pattern that was repeated in
    dataset_state, prefect_pipeline and dataset.py.
    """
    if get_run_logger is not None:
        try:
            return get_run_logger()
        except Exception:
            pass
    return fallback if fallback is not None else _root_logger


def cleanup_old_logs(log_dir, days=30):
    """Remove log files older than specified days."""
    if not os.path.exists(log_dir):
        return

    cutoff_time = time.time() - (days * 86400)  # 86400 seconds in a day
    removed_count = 0

    for filename in os.listdir(log_dir):
        if filename.startswith("harvest_") and filename.endswith(".log"):
            filepath = os.path.join(log_dir, filename)
            if os.path.isfile(filepath) and os.path.getmtime(filepath) < cutoff_time:
                try:
                    os.remove(filepath)
                    removed_count += 1
                    _root_logger.info(f"Removed old log file: {filename}")
                except OSError as e:
                    _root_logger.warning(
                        f"Warning: Failed to remove old log file {filename}: {e}"
                    )

    if removed_count > 0:
        _root_logger.info(
            f"Cleaned up {removed_count} log file(s) older than {days} days"
        )


def setup_logging(log_time, log_level, log_dir=None):
    # Clean up old log files before setting up logging
    if log_dir:
        cleanup_old_logs(log_dir, days=30)

    # setup logging
    logger = _root_logger
    logger.setLevel(logging.getLevelName(log_level.upper()))
    logger.handlers.clear()

    # Define log format
    log_format = (
        ("%(asctime)s - " if log_time else "")
        + "%(levelname)-8s - %(name)s : %(message)s"
    )

    # Add console handler
    c_handler = logging.StreamHandler()
    c_handler.setLevel(logging.getLevelName(log_level.upper()))
    c_format = logging.Formatter(log_format)
    c_handler.setFormatter(c_format)
    logger.addHandler(c_handler)

    # Add file handler with timestamped filename if log directory is specified
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = os.path.join(log_dir, f"harvest_{timestamp}.log")

        f_handler = logging.FileHandler(log_file)
        f_handler.setLevel(logging.getLevelName(log_level.upper()))
        f_format = logging.Formatter(
            "%(asctime)s - %(levelname)-8s - %(name)s : %(message)s"
        )
        f_handler.setFormatter(f_format)
        logger.addHandler(f_handler)
        logger.info(f"Logging to file: {log_file}")

    return logger
