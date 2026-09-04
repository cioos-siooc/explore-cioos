"""Unit tests for cde_harvester.core.issues.

Covers the two properties the grouping depends on: the same complaint about
different values collapses into one signature, and genuinely different complaints
stay apart — plus the extraction of ERDDAP's own error message out of a response.
"""

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from cde_harvester.core.issues import (
    erddap_error_text,
    error_signature,
    group_issues,
    report_issues,
    signature_hash,
)


class _Response:
    def __init__(self, text):
        self.text = text


ERDDAP_ERROR_BODY = """Error {
    code=500;
    message="java.lang.RuntimeException: Query error: Unrecognized constraint variable=&quot;salinity&quot;";
}"""


# ---------------------------------------------------------------------------
# erddap_error_text
# ---------------------------------------------------------------------------

def test_extracts_message_from_erddap_error_envelope():
    assert erddap_error_text(_Response(ERDDAP_ERROR_BODY)) == (
        "java.lang.RuntimeException: Query error: "
        "Unrecognized constraint variable=&quot;salinity&quot;"
    )


def test_falls_back_to_first_line_of_html_body():
    body = "<html><head><title>502 Bad Gateway</title></head><body>\n<h1>nginx</h1></body></html>"
    text = erddap_error_text(_Response(body))
    assert "502 Bad Gateway" in text
    assert "<" not in text


@pytest.mark.parametrize("response", [None, MagicMock(), _Response(""), _Response(None)])
def test_returns_empty_string_when_there_is_no_usable_body(response):
    """Must never raise — it describes an error path, it can't become one."""
    assert erddap_error_text(response) == ""


# ---------------------------------------------------------------------------
# error_signature
# ---------------------------------------------------------------------------

def test_same_complaint_about_different_variables_shares_a_signature():
    a = error_signature('Query error: Unrecognized constraint variable="sea_water_temperature"')
    b = error_signature('Query error: Unrecognized constraint variable="salinity"')
    assert a == b == "Query error: Unrecognized constraint variable=<STR>"


def test_different_complaints_keep_different_signatures():
    a = error_signature("Query error: Unrecognized constraint variable=\"salinity\"")
    b = error_signature("Your query produced no matching results. (nRows = 0)")
    assert a != b
    assert signature_hash(a) != signature_hash(b)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Your query produced no matching results. (nRows = 0)",
         "Your query produced no matching results. (nRows = <N>)"),
        ("HTTP 500 Internal Server Error", "HTTP <N> Internal Server Error"),
        ("Timeout fetching https://x.ca/erddap/tabledap/ds.csv?time",
         "Timeout fetching <URL>"),
        ("No data after 2024-01-05T00:00:00Z", "No data after <TIME>"),
        ("Bad request id 4f8a2b1c9d0e5f6a7b8c9d0e1f2a3b4c", "Bad request id <ID>"),
        ("value 1.5e-3 out of range", "value <N> out of range"),
    ],
)
def test_values_are_replaced_but_wording_is_kept(raw, expected):
    assert error_signature(raw) == expected


def test_signature_is_stable_and_bounded():
    long_error = "Query error: " + ("x" * 5000)
    signature = error_signature(long_error)
    assert len(signature) <= 300
    assert signature_hash(signature) == signature_hash(error_signature(long_error))


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_blank_input_signatures_to_empty(raw):
    assert error_signature(raw) == ""


# ---------------------------------------------------------------------------
# group_issues
# ---------------------------------------------------------------------------

def _attempt(dataset_id, erddap_url, error_message, status="error",
             reason_code="HTTP_ERROR", query_urls=None):
    return {
        "dataset_id": dataset_id,
        "erddap_url": erddap_url,
        "status": status,
        "reason_code": reason_code,
        "error_message": error_message,
        "query_urls": query_urls,
    }


CONSTRAINT_ERROR = 'HTTP 500 Internal Server Error: Query error: Unrecognized constraint variable="{}"'


def test_same_error_on_one_server_groups_its_datasets_together():
    groups = group_issues([
        _attempt("ds1", "https://a.ca/erddap", CONSTRAINT_ERROR.format("salinity"),
                 query_urls="https://a.ca/one\nhttps://a.ca/two"),
        _attempt("ds2", "https://a.ca/erddap", CONSTRAINT_ERROR.format("temp")),
    ])
    assert len(groups) == 1
    assert groups[0].dataset_ids == ["ds1", "ds2"]
    assert groups[0].host == "a.ca"
    assert groups[0].sample_query_url == "https://a.ca/one"


def test_same_error_on_different_servers_stays_separate():
    groups = group_issues([
        _attempt("ds1", "https://a.ca/erddap", CONSTRAINT_ERROR.format("salinity")),
        _attempt("ds2", "https://b.ca/erddap", CONSTRAINT_ERROR.format("salinity")),
    ])
    assert len(groups) == 2
    assert {g.host for g in groups} == {"a.ca", "b.ca"}
    # Same problem, different server: the signature matches but the fingerprint
    # does not, which is what keeps "which server is broken" answerable.
    assert groups[0].signature == groups[1].signature
    assert groups[0].fingerprint_hash == groups[1].fingerprint_hash


def test_different_errors_on_one_server_stay_separate():
    groups = group_issues([
        _attempt("ds1", "https://a.ca/erddap", CONSTRAINT_ERROR.format("salinity")),
        _attempt("ds2", "https://a.ca/erddap", "KeyError: time",
                 reason_code="UNKNOWN_ERROR"),
    ])
    assert len(groups) == 2
    assert {g.reason_code for g in groups} == {"HTTP_ERROR", "UNKNOWN_ERROR"}


def test_successes_and_skips_are_not_issues():
    """Skips like NO_PROFILES_FOUND are expected outcomes, not incidents —
    reporting them would restore the per-dataset noise this replaces."""
    groups = group_issues([
        _attempt("ds1", "https://a.ca/erddap", None, status="success", reason_code=None),
        _attempt("ds2", "https://a.ca/erddap", "no profiles",
                 status="skipped", reason_code="NO_PROFILES_FOUND"),
    ])
    assert groups == []


def test_accepts_a_dataframe_with_null_columns():
    """The harvester passes harvest_attempts straight through, where unset
    columns arrive as NaN rather than None."""
    df = pd.DataFrame([
        _attempt("ds1", "https://a.ca/erddap", CONSTRAINT_ERROR.format("salinity")),
        _attempt("ds2", "https://a.ca/erddap", None, reason_code=None),
    ])
    groups = group_issues(df)
    assert len(groups) == 2
    # A failure with no message still groups, under its reason code.
    assert any(g.signature == "UNKNOWN_ERROR" for g in groups)


@pytest.mark.parametrize("records", [None, [], pd.DataFrame()])
def test_empty_input_yields_no_groups(records):
    assert group_issues(records) == []


# ---------------------------------------------------------------------------
# report_issues
# ---------------------------------------------------------------------------

def test_reports_one_sentry_event_per_group_with_a_scoped_fingerprint():
    records = [
        _attempt("ds1", "https://a.ca/erddap", CONSTRAINT_ERROR.format("salinity")),
        _attempt("ds2", "https://a.ca/erddap", CONSTRAINT_ERROR.format("temp")),
        _attempt("ds3", "https://b.ca/erddap", "KeyError: time",
                 reason_code="UNKNOWN_ERROR"),
    ]
    with patch("cde_harvester.core.issues.sentry_sdk.capture_event") as capture:
        groups = report_issues("harvester", records)

    assert len(groups) == 2
    assert capture.call_count == 2
    events = [call.args[0] for call in capture.call_args_list]

    by_host = {event["tags"]["erddap_host"]: event for event in events}
    assert by_host["a.ca"]["fingerprint"][0] == "harvester"
    assert by_host["a.ca"]["fingerprint"][1] == "a.ca"
    assert by_host["a.ca"]["extra"]["dataset_ids"] == ["ds1", "ds2"]
    assert by_host["a.ca"]["extra"]["dataset_count"] == 2
    assert by_host["a.ca"]["tags"]["reason_code"] == "HTTP_ERROR"
    # Distinct problems must not share a fingerprint.
    assert by_host["a.ca"]["fingerprint"] != by_host["b.ca"]["fingerprint"]


def test_repeat_of_the_same_problem_reuses_the_fingerprint():
    """The whole point: a second run of an unchanged problem must land on the
    existing Sentry issue, so no new-issue alert fires."""
    def fingerprints_for(dataset_ids):
        records = [
            _attempt(ds, "https://a.ca/erddap", CONSTRAINT_ERROR.format(ds))
            for ds in dataset_ids
        ]
        with patch("cde_harvester.core.issues.sentry_sdk.capture_event") as capture:
            report_issues("harvester", records)
        return [call.args[0]["fingerprint"] for call in capture.call_args_list]

    assert fingerprints_for(["ds1"]) == fingerprints_for(["ds1", "ds2", "ds3"])


def test_component_separates_harvester_from_downloader():
    records = [_attempt("ds1", "https://a.ca/erddap", "KeyError: time")]
    fingerprints = []
    for component in ("harvester", "downloader"):
        with patch("cde_harvester.core.issues.sentry_sdk.capture_event") as capture:
            report_issues(component, records)
        fingerprints.append(capture.call_args_list[0].args[0]["fingerprint"])
    assert fingerprints[0] != fingerprints[1]


def test_dataset_id_list_is_capped_but_the_count_is_not():
    records = [
        _attempt(f"ds{n}", "https://a.ca/erddap", "KeyError: time")
        for n in range(120)
    ]
    with patch("cde_harvester.core.issues.sentry_sdk.capture_event") as capture:
        report_issues("harvester", records)
    extra = capture.call_args_list[0].args[0]["extra"]
    assert extra["dataset_count"] == 120
    assert len(extra["dataset_ids"]) == 50
    assert extra["dataset_ids_truncated"] is True


def test_reporting_never_raises_into_the_caller():
    """Observability must not fail a run that otherwise succeeded."""
    records = [_attempt("ds1", "https://a.ca/erddap", "KeyError: time")]
    with patch("cde_harvester.core.issues.sentry_sdk.capture_event",
               side_effect=RuntimeError("sentry down")):
        assert len(report_issues("harvester", records)) == 1
