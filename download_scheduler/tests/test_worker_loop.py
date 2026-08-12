"""Tests for process_next_job — the error containment around a single job.

Regression: __main__ used to call run_download(row) bare inside `while True`,
so one job that raised killed the worker process. With no restart policy on the
service, the queue then had no consumer at all and every later download sat as
an 'open' row forever, with nothing surfaced to the user or the logs.
"""

import pytest

from download_scheduler import download_scheduler as ds


@pytest.fixture
def updates(monkeypatch):
    """Capture update_download_jobs calls as (pk, fields) pairs."""
    calls = []
    monkeypatch.setattr(
        ds, "update_download_jobs", lambda pk, row, session=None: calls.append((pk, row))
    )
    return calls


@pytest.fixture
def job(monkeypatch):
    """A claimable job row."""
    row = {"pk": 42, "job_id": "abc123"}
    monkeypatch.setattr(ds, "get_a_download_job", lambda: row)
    return row


def test_returns_true_and_runs_the_job_on_the_happy_path(monkeypatch, job, updates):
    ran = []
    monkeypatch.setattr(ds, "run_download", ran.append)

    assert ds.process_next_job() is True
    assert ran == [job]
    assert updates == []  # nothing marked failed


def test_returns_true_when_the_queue_is_empty(monkeypatch):
    monkeypatch.setattr(ds, "get_a_download_job", lambda: None)
    monkeypatch.setattr(
        ds, "run_download", lambda row: pytest.fail("should not run without a job")
    )

    assert ds.process_next_job() is True


def test_failing_job_is_marked_failed_instead_of_killing_the_worker(
    monkeypatch, job, updates
):
    def boom(row):
        raise TypeError("the JSON object must be str, bytes or bytearray, not NoneType")

    monkeypatch.setattr(ds, "run_download", boom)

    # the exception must not escape...
    assert ds.process_next_job() is True

    # ...and the job must not be left sitting in 'downloading'
    assert len(updates) == 1
    pk, fields = updates[0]
    assert pk == 42
    assert fields["status"] == "failed"
    assert fields["time_complete"] == "NOW()"
    assert "TypeError" in fields["downloader_output"]


def test_worker_survives_even_if_marking_the_job_failed_also_fails(
    monkeypatch, job
):
    """A database blip while recording the failure must not resurrect the crash."""

    def boom(row):
        raise ValueError("job exploded")

    def also_boom(pk, row, session=None):
        raise RuntimeError("database went away")

    monkeypatch.setattr(ds, "run_download", boom)
    monkeypatch.setattr(ds, "update_download_jobs", also_boom)

    assert ds.process_next_job() is True


def test_unclaimable_job_returns_false_so_the_caller_backs_off(monkeypatch):
    def boom():
        raise RuntimeError("could not connect to database")

    monkeypatch.setattr(ds, "get_a_download_job", boom)
    monkeypatch.setattr(
        ds, "run_download", lambda row: pytest.fail("should not run without a job")
    )

    assert ds.process_next_job() is False


def test_fail_job_strips_characters_sqlalchemy_chokes_on(updates):
    ds.fail_job(7, "boom 50% of the time, it's bad")

    _, fields = updates[0]
    assert "%" not in fields["downloader_output"]
    assert "'" not in fields["downloader_output"]
