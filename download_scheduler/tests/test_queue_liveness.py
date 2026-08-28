"""Opt-in smoke test against a running stack.

The unit tests in this directory exercise the email that gets built once a job
runs. They cannot catch the failure mode where nothing runs the job at all: the
`scheduler` service sits behind the `tools` compose profile, so a plain
`docker compose up` starts the API that accepts download requests but not the
worker that fulfils them. Requests then pile up in cde.download_jobs as `open`
rows forever, with no error surfaced anywhere.

Run against a live stack:

    uv run pytest download_scheduler/tests -m integration

Skipped automatically when no database is reachable, so it stays out of the way
of the normal unit-test run.
"""

import os
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.integration

# How long an 'open' job is allowed to sit before we call it stuck. The
# scheduler polls continuously, so anything older than this means no worker is
# consuming the queue.
STUCK_AFTER = timedelta(minutes=5)


@pytest.fixture(scope="module")
def connection():
    host = os.environ.get("DB_HOST_EXTERNAL") or os.environ.get("DB_HOST", "localhost")
    url = (
        f"postgresql://{os.environ['DB_USER']}:{os.environ['DB_PASSWORD']}"
        f"@{host}:{os.environ.get('DB_PORT', 5432)}/{os.environ['DB_NAME']}"
    )
    try:
        engine = create_engine(url)
        with engine.connect() as conn:
            yield conn
    except Exception as exc:  # nothing listening, wrong creds, no such database
        pytest.skip(f"no database reachable at {host}: {exc}")


def test_no_download_job_stuck_open(connection):
    """An 'open' job older than STUCK_AFTER means the scheduler isn't running."""
    stuck = connection.execute(
        text(
            "SELECT pk, job_id, email, time FROM cde.download_jobs "
            "WHERE status = 'open' AND time < NOW() - :age ORDER BY time"
        ),
        {"age": STUCK_AFTER},
    ).mappings().all()

    assert not stuck, (
        f"{len(stuck)} download job(s) stuck in 'open' for over {STUCK_AFTER}: "
        + ", ".join(f"{r['job_id']} ({r['email']}, queued {r['time']})" for r in stuck)
        + ". The scheduler is probably not running — start it with "
        "`docker compose --profile tools up -d scheduler`."
    )


def test_jobs_that_started_also_finished(connection):
    """A job left in 'downloading' well past STUCK_AFTER means a worker picked
    it up and died mid-download — the user never gets mail either way."""
    stalled = connection.execute(
        text(
            "SELECT pk, job_id, email, time_start FROM cde.download_jobs "
            "WHERE status = 'downloading' AND time_start < NOW() - :age "
            "ORDER BY time_start"
        ),
        {"age": STUCK_AFTER},
    ).mappings().all()

    assert not stalled, (
        f"{len(stalled)} download job(s) stalled mid-download for over {STUCK_AFTER}: "
        + ", ".join(f"{r['job_id']} ({r['email']}, started {r['time_start']})" for r in stalled)
    )
