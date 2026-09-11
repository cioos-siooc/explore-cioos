"""The retry policy the four hand-rolled sessions used to disagree about."""

from cde_common import http


def _adapter(session):
    return session.get_adapter("https://example.org")


class TestRetryStatuses:
    def test_the_waf_and_the_rate_limit_are_both_retried(self):
        """413 came from the ERDDAP copy, 429 from the other three. A caller got
        whichever list its file had been copied from; now everyone gets both."""
        assert 413 in http.RETRY_STATUSES
        assert 429 in http.RETRY_STATUSES

    def test_the_session_uses_that_list(self):
        retry = _adapter(http.retry_session()).max_retries
        assert set(retry.status_forcelist) == set(http.RETRY_STATUSES)


class TestFixedPolicy:
    def test_status_is_not_raised_for(self):
        """Every caller inspects the final response itself — an ERDDAP 5xx body
        distinguishes "no data" from a real failure."""
        assert _adapter(http.retry_session()).max_retries.raise_on_status is False

    def test_retry_after_is_respected(self):
        assert _adapter(http.retry_session()).max_retries.respect_retry_after_header

    def test_only_idempotent_methods_are_retried(self):
        allowed = _adapter(http.retry_session()).max_retries.allowed_methods
        assert set(allowed) == {"GET", "HEAD"}

    def test_retries_are_logged(self):
        """One of the four copies logged what it retried; the rest were silent."""
        assert isinstance(_adapter(http.retry_session()).max_retries, http.LoggingRetry)


class TestPerCallerKnobs:
    def test_total_and_backoff_are_tunable(self):
        retry = _adapter(http.retry_session(total=3, backoff_factor=0.5)).max_retries
        assert retry.total == 3
        assert retry.backoff_factor == 0.5

    def test_pool_size_is_applied_when_the_caller_is_threaded(self):
        adapter = _adapter(http.retry_session(pool_size=10))
        assert adapter._pool_maxsize == 10

    def test_headers_reach_the_session(self):
        session = http.retry_session(headers={"User-Agent": "cioos-cde/test"})
        assert session.headers["User-Agent"] == "cioos-cde/test"


def test_timeouts_are_finite():
    """A server that accepts a connection and then goes silent must not be able
    to wedge the scheduler's single-threaded loop forever."""
    assert 0 < http.DEFAULT_TIMEOUT < http.DATA_TIMEOUT < float("inf")
