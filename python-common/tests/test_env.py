"""``.env`` resolution: ancestors are searched, the environment always wins.

These properties were previously asserted against the harvester's copy of this
logic, and the other two copies (both ``load_dotenv(os.getcwd() + "/.env")``
behind a single-variable sentinel) had neither the ancestor search nor a test.
"""

import os

import pytest

from cde_common import env


@pytest.fixture(autouse=True)
def forget_searched_directories():
    """load_env() searches once per directory; the cache must not leak between tests."""
    env._searched.clear()
    yield
    env._searched.clear()


def test_loads_from_cwd(tmp_path, monkeypatch):
    monkeypatch.delenv("CDE_TEST_SETTING", raising=False)
    (tmp_path / ".env").write_text("CDE_TEST_SETTING=from_cwd\n")
    monkeypatch.chdir(tmp_path)
    env.load_env()
    assert os.environ["CDE_TEST_SETTING"] == "from_cwd"


def test_loads_from_an_ancestor(tmp_path, monkeypatch):
    """The file is as likely to sit at the app root as in a service directory."""
    monkeypatch.delenv("CDE_TEST_SETTING", raising=False)
    (tmp_path / ".env").write_text("CDE_TEST_SETTING=from_parent\n")
    child = tmp_path / "harvester"
    child.mkdir()
    monkeypatch.chdir(child)
    env.load_env()
    assert os.environ["CDE_TEST_SETTING"] == "from_parent"


def test_nearest_wins(tmp_path, monkeypatch):
    monkeypatch.delenv("CDE_TEST_SETTING", raising=False)
    (tmp_path / ".env").write_text("CDE_TEST_SETTING=from_parent\n")
    child = tmp_path / "harvester"
    child.mkdir()
    (child / ".env").write_text("CDE_TEST_SETTING=from_child\n")
    monkeypatch.chdir(child)
    env.load_env()
    assert os.environ["CDE_TEST_SETTING"] == "from_child"


def test_the_real_environment_is_never_overridden(tmp_path, monkeypatch):
    """A container that sets its own variables must not be clobbered by a file."""
    monkeypatch.setenv("CDE_TEST_SETTING", "from_container")
    (tmp_path / ".env").write_text("CDE_TEST_SETTING=from_dotenv\n")
    monkeypatch.chdir(tmp_path)
    env.load_env()
    assert os.environ["CDE_TEST_SETTING"] == "from_container"


def test_no_dotenv_anywhere_is_not_an_error(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    env.load_env()  # must not raise
    assert env.dotenv_path() is None


def test_a_changed_working_directory_is_searched_again(tmp_path, monkeypatch):
    """Caching is per directory, not per process: a Prefect deployment's
    set_working_directory pull step moves the run before anything connects."""
    monkeypatch.delenv("CDE_TEST_SETTING", raising=False)
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    (second / ".env").write_text("CDE_TEST_SETTING=from_second\n")

    monkeypatch.chdir(first)
    env.load_env()
    assert "CDE_TEST_SETTING" not in os.environ

    monkeypatch.chdir(second)
    env.load_env()
    assert os.environ["CDE_TEST_SETTING"] == "from_second"
