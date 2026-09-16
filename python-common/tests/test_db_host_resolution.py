"""The host resolution that had one process connecting to two different places.

``download_scheduler`` built its URL from ``DB_HOST`` while the ``cde_harvester``
code it imported read ``DB_HOST_EXTERNAL``. Every ``.env.sample`` in the tree
ships only ``DB_HOST``, so copying one gave the second half the ``"localhost"``
default rather than an error — and no test could catch the disagreement, because
each half was right about its own variable.
"""

import pytest

from cde_common import db


@pytest.fixture(autouse=True)
def clean_env(tmp_path, monkeypatch):
    """No ambient DB settings, and a cwd with no ``.env`` to be found."""
    for name in (*db.REQUIRED_DB_SETTINGS, *db.DB_HOST_SETTINGS, "DB_PORT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)


def _complete_credentials(monkeypatch):
    monkeypatch.setenv("DB_NAME", "cde")
    monkeypatch.setenv("DB_USER", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "p")


class TestDbHost:
    def test_db_host_external_is_preferred(self, monkeypatch):
        monkeypatch.setenv("DB_HOST_EXTERNAL", "172.16.61.22")
        monkeypatch.setenv("DB_HOST", "db")
        assert db.db_host() == "172.16.61.22"

    def test_db_host_is_accepted_when_external_is_unset(self, monkeypatch):
        """The case that was silently broken: a copied .env.sample sets only this."""
        monkeypatch.setenv("DB_HOST", "db")
        assert db.db_host() == "db"

    def test_empty_external_falls_through_rather_than_winning(self, monkeypatch):
        """Coolify writes empty values for variables left blank in the UI."""
        monkeypatch.setenv("DB_HOST_EXTERNAL", "")
        monkeypatch.setenv("DB_HOST", "db")
        assert db.db_host() == "db"

    def test_localhost_when_neither_is_set(self):
        assert db.db_host() == db.DEFAULT_DB_HOST

    def test_url_and_db_host_agree(self, monkeypatch):
        """The invariant: what db_host() reports is what the URL connects to."""
        _complete_credentials(monkeypatch)
        monkeypatch.setenv("DB_HOST", "db")
        assert db.db_host() == "db"
        assert db.database_url() == "postgresql://postgres:p@db:5432/cde"


class TestRequiredSettings:
    def test_every_gap_is_named(self, monkeypatch):
        with pytest.raises(ValueError, match="DB_NAME, DB_USER, DB_PASSWORD"):
            db.database_url()

    def test_host_and_port_are_not_required(self, monkeypatch):
        """Both have working defaults, so neither may be reported as missing."""
        _complete_credentials(monkeypatch)
        assert db.missing_db_settings() == []
        assert db.database_url().endswith("@localhost:5432/cde")

    def test_port_override(self, monkeypatch):
        _complete_credentials(monkeypatch)
        monkeypatch.setenv("DB_PORT", "5433")
        assert db.database_url().endswith(":5433/cde")
