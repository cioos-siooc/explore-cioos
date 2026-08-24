"""Group pipeline failures into one Sentry issue per (component, server, error).

The reason codes in ``errors`` are deliberately coarse — ``HTTP_ERROR`` covers
every non-200 and ``UNKNOWN_ERROR`` every unexpected exception — so grouping on
them lumps unrelated failures into one bucket. Grouping instead on a *normalized*
form of the error the server actually returned keeps distinct problems distinct
while collapsing the same complaint about different variables/datasets/times.

Sentry owns de-duplication: each group is reported with an explicit fingerprint
of ``[component, host, signature_hash]``, so a repeat of a known problem lands on
the existing issue (no new-issue alert) and a genuinely new one opens a new issue.

Shared by the harvest side and the downloader, which already imports
``cde_harvester``.
"""

import hashlib
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

import sentry_sdk

logger = logging.getLogger(__name__)

# Longest error text we keep. ERDDAP happily returns a stack trace; the leading
# clause is what identifies the problem, the rest just bloats the event.
MAX_ERROR_CHARS = 500
MAX_SIGNATURE_CHARS = 300
# Dataset ids per event. The count is always reported; the list is a sample so a
# server failing thousands of datasets can't blow up the Sentry payload.
MAX_DATASET_IDS = 50

# ERDDAP error envelope: Error { code=500; message="Query error: ..."; }
_ERDDAP_MESSAGE_RE = re.compile(
    r'message\s*=\s*"(.*?)"\s*;?\s*\}?\s*$', re.DOTALL | re.IGNORECASE
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")

# Value-stripping rules, applied in order. URLs and quoted literals must run
# before the numeric rule, or their embedded digits get replaced first and the
# broader patterns stop matching.
_NORMALIZERS = (
    (re.compile(r"https?://\S+"), "<URL>"),
    (re.compile(r"&quot;.*?&quot;", re.DOTALL), "<STR>"),
    (re.compile(r'"[^"]*"'), "<STR>"),
    (re.compile(r"'[^']*'"), "<STR>"),
    (re.compile(
        r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?"
    ), "<TIME>"),
    (re.compile(r"\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b", re.I), "<ID>"),
    (re.compile(r"\b[0-9a-f]{16,}\b", re.I), "<ID>"),
    (re.compile(r"[-+]?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b"), "<N>"),
)


def erddap_error_text(response):
    """The human-readable error out of an ERDDAP ``Response``, best-effort.

    ERDDAP reports failures as ``Error { code=500; message="..."; }``. When the
    body isn't in that shape (an HTML error page, a proxy's response) fall back
    to the first non-empty line with tags stripped, so there is always something
    more specific than the HTTP status line to group on.
    """
    text = getattr(response, "text", None)
    # Guard the type, not just emptiness: a response whose .text isn't a string
    # (a test double, a non-decoding adapter) must degrade to "no detail", never
    # blow up the error path it is meant to describe.
    if not isinstance(text, str) or not text.strip():
        return ""
    text = text.strip()

    match = _ERDDAP_MESSAGE_RE.search(text)
    if match:
        # ERDDAP escapes inner quotes as &quot; — leave them, the normalizer
        # collapses them to <STR> and they help identify the complaint.
        text = match.group(1).strip()
    else:
        text = _HTML_TAG_RE.sub(" ", text)
        text = next((line for line in text.splitlines() if line.strip()), "")

    return _WHITESPACE_RE.sub(" ", text).strip()[:MAX_ERROR_CHARS]


def error_signature(text):
    """Normalize an error message into a stable grouping template.

    Values (quoted literals, numbers, timestamps, URLs, ids) become placeholders;
    the wording is kept. So ``Unrecognized constraint variable="salinity"`` and
    ``...variable="sea_water_temp"`` share a signature, while a different
    complaint from the same server does not.
    """
    signature = _WHITESPACE_RE.sub(" ", (text or "").strip())
    for pattern, placeholder in _NORMALIZERS:
        signature = pattern.sub(placeholder, signature)
    return signature.strip()[:MAX_SIGNATURE_CHARS]


def signature_hash(signature):
    """Short stable hash of a signature — the varying part of the fingerprint."""
    return hashlib.sha1(signature.encode("utf-8")).hexdigest()[:8]


def _host(erddap_url):
    """Hostname of an ERDDAP URL, for grouping and the Sentry fingerprint."""
    url = (erddap_url or "").strip()
    if not url:
        return "unknown"
    parsed = urlparse(url if "://" in url else "https://" + url)
    return parsed.hostname or url


@dataclass
class IssueGroup:
    """One distinct problem on one server, with the datasets it affects."""

    host: str
    erddap_url: str
    signature: str
    reason_code: str
    sample_error: str
    sample_query_url: str = None
    dataset_ids: list = field(default_factory=list)

    @property
    def fingerprint_hash(self):
        return signature_hash(self.signature)

    def __str__(self):
        return (
            f"{self.host}: {self.signature} "
            f"[{self.reason_code}] ({len(self.dataset_ids)} datasets)"
        )


def _as_records(records):
    """Accept a DataFrame (harvester attempts) or a list of dicts (downloader)."""
    if records is None:
        return []
    to_dict = getattr(records, "to_dict", None)
    if to_dict is not None and hasattr(records, "columns"):
        return [] if records.empty else to_dict("records")
    return list(records)


def _is_missing(value):
    """None / NaN / blank — pandas hands back NaN for null CSV columns."""
    return value is None or value != value or str(value).strip() == ""


def group_issues(records):
    """Group failure records by (server, normalized error).

    A record is anything carrying ``erddap_url``, ``dataset_id``, ``reason_code``
    and ``error_message``. Records whose ``status`` is present and not ``error``
    are ignored: skips like ``NO_PROFILES_FOUND`` are expected outcomes, not
    incidents, and reporting them would restore the noise we're removing.
    """
    groups = {}
    for record in _as_records(records):
        status = record.get("status")
        if not _is_missing(status) and status != "error":
            continue

        reason_code = record.get("reason_code")
        reason_code = "UNKNOWN_ERROR" if _is_missing(reason_code) else str(reason_code)
        error_message = record.get("error_message")
        # No message to group on (a bare failure) — fall back to the reason code
        # so the group is still per-server and still distinguishable.
        error_message = reason_code if _is_missing(error_message) else str(error_message)

        erddap_url = "" if _is_missing(record.get("erddap_url")) else str(record["erddap_url"])
        host = _host(erddap_url)
        signature = error_signature(error_message)
        key = (host, signature)

        group = groups.get(key)
        if group is None:
            query_urls = record.get("query_urls")
            group = groups[key] = IssueGroup(
                host=host,
                erddap_url=erddap_url,
                signature=signature,
                reason_code=reason_code,
                sample_error=error_message[:MAX_ERROR_CHARS],
                sample_query_url=(
                    None if _is_missing(query_urls)
                    else str(query_urls).splitlines()[0]
                ),
            )

        dataset_id = record.get("dataset_id")
        if not _is_missing(dataset_id):
            group.dataset_ids.append(str(dataset_id))

    return sorted(groups.values(), key=lambda g: (g.host, g.signature))


def report_issues(component, records, log=None):
    """Report one Sentry event per distinct (server, error) in ``records``.

    ``component`` is the pipeline reporting ("harvester" / "downloader") and forms
    the first fingerprint element so the two never share an issue. Returns the
    groups so callers can surface them in a run summary.

    Reporting is observability, never a reason to fail a run that otherwise
    succeeded: any failure here is logged and swallowed.
    """
    # Messages are pre-formatted and no stdlib-only kwargs (%s args, exc_info)
    # are used: callers pass either a stdlib logger or loguru's, and loguru
    # formats with {} and would silently drop both.
    log = log or logger
    try:
        groups = group_issues(records)
    except Exception as e:
        log.warning(f"Could not group {component} issues for reporting: {e!r}")
        return []

    for group in groups:
        # Always log, so the grouping is useful with no SENTRY_DSN (dev) and the
        # run log names the distinct problems without a Sentry round-trip.
        log.warning(f"Issue group — {group}")
        try:
            sentry_sdk.capture_event({
                "level": "error",
                "message": f"{group.signature} — {group.host} ({len(group.dataset_ids)} datasets)",
                # Grouping key. Sentry de-dupes on this, so a repeat of a known
                # problem raises no new-issue alert.
                "fingerprint": [component, group.host, group.fingerprint_hash],
                "tags": {
                    "component": component,
                    "erddap_url": group.erddap_url,
                    "erddap_host": group.host,
                    "reason_code": group.reason_code,
                },
                "extra": {
                    "dataset_count": len(group.dataset_ids),
                    "dataset_ids": group.dataset_ids[:MAX_DATASET_IDS],
                    "dataset_ids_truncated": len(group.dataset_ids) > MAX_DATASET_IDS,
                    "sample_error_message": group.sample_error,
                    "sample_query_url": group.sample_query_url,
                    "error_signature": group.signature,
                },
            })
        except Exception as e:
            log.warning(f"Could not report issue group to Sentry: {group}: {e!r}")

    return groups
