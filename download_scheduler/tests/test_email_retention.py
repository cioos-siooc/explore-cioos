"""The download address is cleared 7 days after the job finishes (see the
privacy notice in the frontend's PrivacyModal)."""

import json
import os

import pytest
from sqlalchemy import create_engine, text

from download_scheduler import download_scheduler as ds


def test_a_database_error_is_reported_not_raised(monkeypatch):
    def down():
        raise ConnectionError("database is down")

    captured = []
    monkeypatch.setattr(ds.engine, "begin", down)
    monkeypatch.setattr(ds.sentry_sdk, "capture_exception", lambda: captured.append(1))

    ds.forget_expired_emails()  # the worker loop must survive this

    assert captured == [1]


@pytest.fixture
def connection():
    host = os.environ.get("DB_HOST_EXTERNAL") or os.environ.get("DB_HOST", "localhost")
    url = (
        f"postgresql://{os.environ['DB_USER']}:{os.environ['DB_PASSWORD']}"
        f"@{host}:{os.environ.get('DB_PORT', 5432)}/{os.environ['DB_NAME']}"
    )
    try:
        conn = create_engine(url).connect()
    except Exception as exc:
        pytest.skip(f"no database reachable at {host}: {exc}")
    transaction = conn.begin()
    yield conn
    transaction.rollback()
    conn.close()


@pytest.mark.integration
def test_clears_finished_jobs_past_retention_only(connection):
    def job(job_id, status, age_days, completed):
        email = f"{job_id}@example.invalid"
        connection.execute(
            text(
                "INSERT INTO cde.download_jobs "
                "(job_id, email, status, time, time_complete, downloader_input) "
                "VALUES (:job_id, :email, :status, NOW() - make_interval(days => :age), "
                "CASE WHEN :completed THEN NOW() - make_interval(days => :age) END, :input)"
            ),
            {
                "job_id": job_id,
                "email": email,
                "status": status,
                "age": age_days,
                "completed": completed,
                "input": json.dumps({"user_query": {"email": email, "job_id": job_id}}),
            },
        )

    job("zz_old", "completed", 9, True)
    job("zz_failed", "failed", 9, False)
    job("zz_recent", "completed", 2, True)
    job("zz_queued", "open", 9, False)

    connection.execute(ds.FORGET_EMAILS_SQL)

    rows = {
        r.job_id: (r.email, r.email_domain, json.loads(r.downloader_input)["user_query"])
        for r in connection.execute(
            text("SELECT job_id, email, email_domain, downloader_input FROM cde.download_jobs WHERE job_id LIKE 'zz_%'")
        )
    }
    assert rows["zz_old"] == (None, "example.invalid", {"job_id": "zz_old"})
    assert rows["zz_failed"] == (None, "example.invalid", {"job_id": "zz_failed"})
    assert rows["zz_recent"][0] == "zz_recent@example.invalid"
    assert rows["zz_queued"][0] == "zz_queued@example.invalid"
