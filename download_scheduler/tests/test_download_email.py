"""Tests for the completion email: which datasets get cited, which get listed as
omitted, and how the download link is built.

Every assertion here corresponds to a bug that has already been fixed once —
see the regression notes on the individual tests.
"""

import smtplib
from unittest.mock import patch

import pytest

from download_scheduler import download_email
from download_scheduler import download_scheduler as ds

WAF_URL = "https://cde.example.ca/downloads"


def _erddap_dataset(dataset_id="IOS_CTD_Profiles", status="COMPLETED", ckan_id=None):
    return {
        "erddap_url": "https://data.cioospacific.ca/erddap",
        "dataset_id": dataset_id,
        "ckan_id": ckan_id,
        "status": status,
    }


def _obis_dataset(dataset_id="a1b2c3", status="COMPLETED"):
    # The downloader marks OBIS datasets by putting the obis.org sentinel in
    # erddap_url — they are not on an ERDDAP server at all.
    return {
        "erddap_url": "https://obis.org",
        "dataset_id": dataset_id,
        "ckan_id": None,
        "status": status,
    }


def _report(*datasets):
    return {"erddap_report": list(datasets)}


@pytest.fixture
def sent(monkeypatch):
    """Capture the (to, body, subject) that email_user hands to send_email."""
    calls = []
    monkeypatch.setattr(ds, "send_email", lambda *args: calls.append(args))
    monkeypatch.setenv("DOWNLOAD_WAF_URL", WAF_URL)
    return calls


# --------------------------------------------------------------------------
# download link
# --------------------------------------------------------------------------


@pytest.mark.parametrize("waf_url", [WAF_URL, WAF_URL + "/"])
def test_download_url_joined_with_exactly_one_slash(sent, monkeypatch, waf_url):
    """Regression (b5eabde3): plain concatenation produced
    '.../downloadscde_download_x.zip' — a dead link in every success email."""
    monkeypatch.setenv("DOWNLOAD_WAF_URL", waf_url)

    ds.email_user("a@b.ca", "completed", "cde_download_x.zip", _report(_erddap_dataset()), "en")

    body = sent[0][1]
    assert f"{WAF_URL}/cde_download_x.zip" in body
    assert "downloadscde_download" not in body


# --------------------------------------------------------------------------
# dataset citations
# --------------------------------------------------------------------------


def test_erddap_dataset_cited_with_info_page(sent):
    ds.email_user("a@b.ca", "completed", "z.zip", _report(_erddap_dataset()), "en")

    body = sent[0][1]
    assert (
        "ERDDAP: https://data.cioospacific.ca/erddap/info/IOS_CTD_Profiles/index.html"
        in body
    )


def test_obis_dataset_cited_with_obis_dataset_page(sent):
    """Regression (e84ff3bd): OBIS datasets were cited with an ERDDAP
    /info/<id>/index.html URL, which does not exist for them."""
    ds.email_user("a@b.ca", "completed", "z.zip", _report(_obis_dataset("a1b2c3")), "en")

    body = sent[0][1]
    assert "OBIS: https://obis.org/dataset/a1b2c3" in body
    assert "/info/" not in body


def test_ckan_url_included_when_dataset_has_ckan_id(sent):
    ds.email_user(
        "a@b.ca", "completed", "z.zip", _report(_erddap_dataset(ckan_id="ckan-99")), "en"
    )

    body = sent[0][1]
    assert "CKAN: https://catalogue.cioos.ca/dataset/ckan-99" in body


def test_ckan_line_omitted_when_dataset_has_no_ckan_id(sent):
    ds.email_user("a@b.ca", "completed", "z.zip", _report(_erddap_dataset()), "en")

    assert "CKAN:" not in sent[0][1]


# --------------------------------------------------------------------------
# omitted datasets
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status,reason",
    [
        ("FAILED", "could not be retrieved from its source"),
        ("EMPTY", "had no data matching your selection"),
        ("IGNORED", "was skipped because the download size limit was reached"),
    ],
)
def test_omitted_dataset_is_listed_with_reason_and_not_cited(sent, status, reason):
    """Regression (e84ff3bd): datasets that never made it into the zip were
    still cited as sources, so users were told to cite data they didn't get."""
    ds.email_user(
        "a@b.ca",
        "completed",
        "z.zip",
        _report(_erddap_dataset("Good"), _erddap_dataset("Bad", status=status)),
        "en",
    )

    body = sent[0][1]
    assert f"- Bad — {reason}." in body
    # the omitted dataset must not appear in the citation list
    assert "/info/Bad/index.html" not in body
    # ...while the one that did make it still does
    assert "/info/Good/index.html" in body


@pytest.mark.parametrize("status", ["COMPLETED", "PARTIAL"])
def test_included_statuses_are_cited_not_listed_as_omitted(sent, status):
    ds.email_user(
        "a@b.ca", "completed", "z.zip", _report(_erddap_dataset(status=status)), "en"
    )

    body = sent[0][1]
    assert "/info/IOS_CTD_Profiles/index.html" in body
    assert "could not be included in this download" not in body


def test_unknown_status_falls_back_to_generic_reason(sent):
    ds.email_user(
        "a@b.ca", "completed", "z.zip", _report(_erddap_dataset("Odd", status="WEIRD")), "en"
    )

    assert "- Odd — could not be included." in sent[0][1]


# --------------------------------------------------------------------------
# subjects, templates and languages
# --------------------------------------------------------------------------


def test_over_limit_uses_completed_template_but_over_limit_subject(sent):
    ds.email_user("a@b.ca", "over-limit", "z.zip", _report(_erddap_dataset()), "en")

    _, body, subject = sent[0]
    assert "cut off to return less data" in body
    # the zip still exists and must still be linked
    assert f"{WAF_URL}/z.zip" in body
    assert subject.startswith(
        "Your CIOOS Data Explorer data query completed but found too much data."
    )


def test_english_first_puts_english_subject_and_body_first(sent):
    ds.email_user("a@b.ca", "completed", "z.zip", _report(_erddap_dataset()), "en")

    _, body, subject = sent[0]
    assert subject.startswith("Your CIOOS Data Explorer query was successful")
    assert "fût complétée avec succès" in subject  # French still included
    assert body.index("completed successfully") < body.index("Votre téléchargement")


def test_french_first_puts_french_subject_and_body_first(sent):
    ds.email_user("a@b.ca", "completed", "z.zip", _report(_erddap_dataset()), "fr")

    _, body, subject = sent[0]
    assert subject.startswith("Votre requête à l'Explorateur de Données du SIOOC")
    assert "was successful" in subject
    assert body.index("Votre téléchargement") < body.index("completed successfully")


@pytest.mark.parametrize("status", ["no-data", "failed"])
def test_failure_statuses_render_without_downloader_output(sent, status):
    """run_download passes downloader_output="" on failure — rendering must not
    blow up, and the user must still get mail."""
    ds.email_user("a@b.ca", status, "z.zip", "", "en")

    to, body, subject = sent[0]
    assert to == "a@b.ca"
    assert body.strip()
    assert subject


# --------------------------------------------------------------------------
# SMTP layer
# --------------------------------------------------------------------------


def test_no_smtp_connection_when_gmail_user_unset(monkeypatch):
    monkeypatch.delenv("GMAIL_USER", raising=False)

    with patch("download_scheduler.download_email.smtplib.SMTP_SSL") as smtp:
        download_email.send_email("a@b.ca", "body", "subject")

    assert not smtp.called


def test_send_email_builds_message_and_sends_it(monkeypatch):
    monkeypatch.setenv("GMAIL_USER", "sender@example.invalid")
    monkeypatch.setenv("GMAIL_PASSWORD", "app-password")

    with patch("download_scheduler.download_email.smtplib.SMTP_SSL") as smtp:
        download_email.send_email("a@b.ca", "the body", "the subject")

    smtp.assert_called_once_with("smtp.gmail.com", 465)
    server = smtp.return_value
    server.login.assert_called_once_with("sender@example.invalid", "app-password")

    msg = server.send_message.call_args[0][0]
    assert msg["To"] == "a@b.ca"
    assert msg["From"] == "sender@example.invalid"
    assert msg["Subject"] == "the subject"
    assert msg.get_content().strip() == "the body"


def test_smtp_auth_failure_is_swallowed(monkeypatch):
    """Regression (3879e1e5): the except branch itself raised AttributeError,
    because loguru's logger.error treats its first arg as a format string."""
    monkeypatch.setenv("GMAIL_USER", "sender@example.invalid")
    monkeypatch.setenv("GMAIL_PASSWORD", "wrong")

    with patch("download_scheduler.download_email.smtplib.SMTP_SSL") as smtp:
        smtp.return_value.login.side_effect = smtplib.SMTPAuthenticationError(
            535, b"Username and Password not accepted"
        )
        download_email.send_email("a@b.ca", "body", "subject")  # must not raise
