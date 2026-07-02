"""Sentry init and logging helpers shared by the harvest and loading sides."""

import logging
import os
import time
from datetime import datetime

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

try:
    from prefect import get_run_logger
except Exception:
    get_run_logger = None

_root_logger = logging.getLogger()


def init_sentry():
    """Identical Sentry setup previously inlined in both package __main__ modules."""
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        integrations=[
            LoggingIntegration(
                level=logging.INFO,  # Capture info and above as breadcrumbs
                event_level=logging.WARNING,  # Send records as events
            ),
        ],
        environment=os.environ.get("ENVIRONMENT", "development"),
    )


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
