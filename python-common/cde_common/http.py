"""One retry session, and one timeout policy, for every upstream we talk to.

There were four hand-rolled versions of ``requests.Session`` + ``Retry`` +
``HTTPAdapter`` in the tree (the ERDDAP client, the CKAN reader, OBIS discovery
and the WoRMS vernacular loader), agreeing on the shape and disagreeing on the
details — three different status lists, two different back-off factors, and only
one of them logging what it retried and why. The disagreements read as accidents
rather than decisions: the ERDDAP list had 413 (a WAF quirk) but not 429, while
the other three had 429 but not 413.

What genuinely differs per upstream is how hard to try and how fast to back off,
so ``total``/``backoff_factor`` stay arguments. The status list, the two Retry
flags that must not vary, and the retry logging are settled here.
"""

import logging

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

# Transient statuses worth retrying:
#   408  Request Timeout   — seen on the cioosatlantic/cioospacific CTD-profile
#                            endpoints under load; the same query succeeds later.
#   413  Payload Too Large — seagull-erddap's WAF returns it when requests
#                            arrive in parallel too quickly. The queries
#                            themselves are tiny and succeed after backoff.
#   429  Too Many Requests — CKAN, OBIS and WoRMS all rate-limit; combined with
#                            respect_retry_after_header below this is the
#                            polite response, not a workaround.
#   5xx                    — 500 is included even though some ERDDAPs use it
#                            semantically for "no data" / "query too big"; those
#                            responses have a body the caller still inspects, so
#                            the retry only bites when the server keeps
#                            returning 500 — i.e. it really is broken. 520/522/
#                            524 are Cloudflare's transient trio.
RETRY_STATUSES = (408, 413, 429, 500, 502, 503, 504, 520, 522, 524)

# Connect + read timeout for a metadata or API call. Every outbound request needs
# one: without it a server that accepts the connection and then goes silent
# blocks its caller forever, which for the download scheduler's single-threaded
# `while True` loop means the whole queue stops.
DEFAULT_TIMEOUT = 60

# A data query, where ERDDAP may spend a long time assembling the response before
# the first byte arrives. Still finite, for the reason above.
DATA_TIMEOUT = 3600

# urllib3 logs its own generic "Retrying (Retry(total=3, …)) after connection
# broken by '…': /rest/…" line, which says less than LoggingRetry below and would
# duplicate every retry. Same shape as the client's urllib3 quieting.
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)


class LoggingRetry(Retry):
    """urllib3.Retry that logs each retry with the full URL and the reason."""

    def increment(
        self,
        method=None,
        url=None,
        response=None,
        error=None,
        _pool=None,
        _stacktrace=None,
    ):
        full_url = url or ""
        if _pool is not None and url:
            full_url = f"{_pool.scheme}://{_pool.host}{url}"
        if error is not None:
            reason = f"{type(error).__name__}: {error}"
        elif response is not None:
            reason = f"HTTP {response.status}"
        else:
            reason = "unknown"
        attempts_left = self.total - 1 if isinstance(self.total, int) else "?"
        logger.info(
            "Retrying %s %s (attempts left=%s) after %s",
            method or "GET",
            full_url,
            attempts_left,
            reason,
        )
        return super().increment(
            method=method,
            url=url,
            response=response,
            error=error,
            _pool=_pool,
            _stacktrace=_stacktrace,
        )


def retry_session(total=4, backoff_factor=1.0, pool_size=None, headers=None):
    """A ``requests.Session`` that retries transient failures on GET and HEAD.

    ``total`` bounds every retry kind (connect, read and status), and
    ``backoff_factor`` sets the waits between attempts: 1.0 gives 0s/2s/4s/8s,
    0.5 gives 0.5s/1s/2s/4s. Pass ``pool_size`` when the caller is threaded, or
    urllib3 discards and re-establishes connections ("Connection pool is full")
    and thrashes the upstream with TLS reconnects.

    Two flags are fixed rather than optional:

    * ``raise_on_status=False`` — every caller inspects the final response
      itself, either for ``raise_for_status()``'s cleaner error or because an
      ERDDAP 5xx body distinguishes "no data" from a real failure.
    * ``respect_retry_after_header=True`` — a server that tells us how long to
      wait is obeyed.
    """
    session = requests.Session()
    retry = LoggingRetry(
        total=total,
        backoff_factor=backoff_factor,
        status_forcelist=RETRY_STATUSES,
        # Both are idempotent, so both are safe to repeat. Nothing here retries
        # a POST.
        allowed_methods=frozenset(["GET", "HEAD"]),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter_kwargs = {"max_retries": retry}
    if pool_size:
        adapter_kwargs["pool_connections"] = pool_size
        adapter_kwargs["pool_maxsize"] = pool_size
    adapter = HTTPAdapter(**adapter_kwargs)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    if headers:
        session.headers.update(headers)
    return session
