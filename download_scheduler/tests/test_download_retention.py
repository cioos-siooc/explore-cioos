"""Download zips are deleted DOWNLOAD_RETENTION_DAYS after they are written, the
lifetime the email and the Download modal state."""

import os
import time

from download_scheduler import download_scheduler as ds


def _zip(folder, name, age_days):
    path = folder / name
    path.write_bytes(b"zip")
    mtime = time.time() - age_days * 24 * 60 * 60
    os.utime(path, (mtime, mtime))
    return path


def test_deletes_only_zips_past_retention(tmp_path, monkeypatch):
    monkeypatch.setattr(ds, "output_folder", str(tmp_path))
    expired = _zip(tmp_path, "cde_download_old.zip", ds.DOWNLOAD_RETENTION_DAYS + 1)
    fresh = _zip(tmp_path, "cde_download_new.zip", ds.DOWNLOAD_RETENTION_DAYS - 1)
    heartbeat = _zip(tmp_path, "healthz", ds.DOWNLOAD_RETENTION_DAYS + 1)

    ds.delete_expired_downloads()

    assert not expired.exists()
    assert fresh.exists()
    assert heartbeat.exists()


def test_a_filesystem_error_is_reported_not_raised(tmp_path, monkeypatch):
    monkeypatch.setattr(ds, "output_folder", str(tmp_path))
    _zip(tmp_path, "cde_download_old.zip", ds.DOWNLOAD_RETENTION_DAYS + 1)

    def denied(self, missing_ok=False):
        raise PermissionError("read-only volume")

    captured = []
    monkeypatch.setattr(ds.pathlib.Path, "unlink", denied)
    monkeypatch.setattr(ds.sentry_sdk, "capture_exception", lambda: captured.append(1))

    ds.delete_expired_downloads()  # the worker loop must survive this

    assert captured == [1]


def test_email_states_the_link_lifetime_in_both_languages(monkeypatch):
    sent = []
    monkeypatch.setattr(ds, "send_email", lambda *args: sent.append(args))
    monkeypatch.setenv("DOWNLOAD_WAF_URL", "https://cde.example.ca/downloads")
    report = {
        "erddap_report": [
            {
                "erddap_url": "https://data.cioospacific.ca/erddap",
                "dataset_id": "IOS_CTD_Profiles",
                "ckan_id": None,
                "status": "COMPLETED",
            }
        ]
    }

    ds.email_user("a@b.ca", "completed", "z.zip", report, "en")

    body = sent[0][1]
    assert f"for {ds.DOWNLOAD_RETENTION_DAYS} days" in body
    assert f"pendant {ds.DOWNLOAD_RETENTION_DAYS} jours" in body
