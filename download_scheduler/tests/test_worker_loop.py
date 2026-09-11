"""Tests for process_next_job — the error containment around a single job.

Regression: __main__ used to call run_download(row) bare inside `while True`,
so one job that raised killed the worker process. With no restart policy on the
service, the queue then had no consumer at all and every later download sat as
an 'open' row forever, with nothing surfaced to the user or the logs.
"""

import contextlib

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
    assert fields["time_complete"] is ds.SQL_NOW
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


def test_fail_job_records_the_error_verbatim(updates):
    # update_download_jobs binds its values now, so nothing has to be mangled on
    # the way in. This used to strip every "%" and "'" out of the message
    # because the statement was built by f-string.
    message = "boom 50% of the time, it's bad"
    ds.fail_job(7, message)

    pk, fields = updates[0]
    assert pk == 7
    assert fields["status"] == "failed"
    assert fields["downloader_output"] == message
    assert fields["time_complete"] is ds.SQL_NOW


class TestUpdateDownloadJobs:
    """The one writer to cde.download_jobs.

    It formats column names into the statement (they are literals in the module)
    but must bind every value: they carry tracebacks and the downloader's JSON
    report, which are exactly the strings an f-string-built UPDATE breaks on.
    """

    @pytest.fixture
    def executed(self, monkeypatch):
        """Capture (sql_text, params) from the engine.begin() path."""
        calls = []

        class FakeConnection:
            def execute(self, statement, params=None):
                calls.append((str(statement), params))

        class FakeEngine:
            @contextlib.contextmanager
            def begin(self):
                yield FakeConnection()

        monkeypatch.setattr(ds, "engine", FakeEngine())
        return calls

    def test_binds_values_instead_of_interpolating_them(self, executed):
        report = """{"note": "100% done, don't drop this"}"""
        ds.update_download_jobs(42, {"status": "failed", "erddap_report": report})

        sql, params = executed[0]
        assert sql == (
            "UPDATE cde.download_jobs SET status = :status, "
            "erddap_report = :erddap_report WHERE pk = :pk"
        )
        assert params == {"pk": 42, "status": "failed", "erddap_report": report}
        # The value itself never reaches the statement text.
        assert report not in sql

    def test_sql_now_becomes_a_database_expression_not_a_bound_string(self, executed):
        ds.update_download_jobs(42, {"status": "completed", "time_complete": ds.SQL_NOW})

        sql, params = executed[0]
        assert "time_complete = NOW()" in sql
        assert "time_complete" not in params

    def test_a_caller_owned_session_gets_the_same_statement_and_params(self):
        calls = []

        class FakeSession:
            def execute(self, statement, params=None):
                calls.append((str(statement), params))

        ds.update_download_jobs(7, {"status": "downloading"}, FakeSession())

        assert calls == [
            ("UPDATE cde.download_jobs SET status = :status WHERE pk = :pk",
             {"pk": 7, "status": "downloading"}),
        ]


class TestPrefectObservability:
    """run_download_observed — the Prefect wrapper around a single job.

    Each download becomes a flow run so the queue is visible in the same UI as
    the harvests. The wrapper must stay invisible when Prefect is not
    configured, and must never let a job's own outcome escape as an exception:
    run_download has already written the status row and emailed the user, so a
    raise reaching process_next_job would mark the job failed a second time and
    replace that status with a traceback.
    """

    def test_runs_the_job_directly_when_prefect_is_not_configured(
        self, monkeypatch, job
    ):
        monkeypatch.delenv("PREFECT_API_URL", raising=False)
        ran = []
        monkeypatch.setattr(ds, "run_download", ran.append)

        ds.run_download_observed(job)

        assert ran == [job]

    def test_prefect_is_off_by_default_and_on_with_an_api_url(self, monkeypatch):
        monkeypatch.delenv("PREFECT_API_URL", raising=False)
        assert ds._prefect_enabled() is False

        monkeypatch.setenv("PREFECT_API_URL", "http://prefect:4200/api")
        assert ds._prefect_enabled() is True

    def test_a_failed_job_does_not_raise_past_the_wrapper(self, monkeypatch, job):
        """A 'failed' status becomes a red flow run, not a second failure.

        Regression guard for the double-marking path: process_next_job's except
        branch calls fail_job, which would overwrite the real downloader error
        with this wrapper's traceback.
        """
        monkeypatch.delenv("PREFECT_API_URL", raising=False)
        monkeypatch.setattr(ds, "run_download", lambda row: "failed")

        ds.run_download_observed(job)  # must not raise

    def test_a_crash_inside_the_job_still_propagates(self, monkeypatch, job):
        """Only the job's own outcome is swallowed; real crashes must reach
        process_next_job so the row gets marked failed rather than sitting in
        'downloading' forever."""
        monkeypatch.delenv("PREFECT_API_URL", raising=False)

        def boom(row):
            raise TypeError("malformed job row")

        monkeypatch.setattr(ds, "run_download", boom)

        with pytest.raises(TypeError):
            ds.run_download_observed(job)

    def test_failed_status_set_is_only_real_faults(self):
        """no-data and over-limit are outcomes the user is emailed about, not
        faults, so they must not turn the flow run red."""
        assert "failed" in ds.FAILED_STATUSES
        assert "no-data" not in ds.FAILED_STATUSES
        assert "over-limit" not in ds.FAILED_STATUSES
        assert "completed" not in ds.FAILED_STATUSES
