import os
import subprocess
import sys

import pytest
from cde_harvester.sources.ckan.create_ckan_erddap_link import _build_ckan_session
from cde_harvester.sources.erddap.client import _build_retry_session
from cde_harvester.sources.obis.discovery import _build_session
from cde_harvester.user_agent import USER_AGENT


def _agent(**env):
    clean = {k: v for k, v in os.environ.items() if k not in ("APP_URL", "APP_VERSION")}
    return subprocess.run(
        [sys.executable, "-c", "from cde_harvester.user_agent import USER_AGENT; print(USER_AGENT)"],
        env=clean | env, capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_agent_names_the_deployment_and_build():
    agent = _agent(APP_URL="https://explore.example.ca", APP_VERSION="v1.2.3")
    assert agent == "CIOOS-CDE-Harvester/v1.2.3 (+https://explore.example.ca)"


def test_agent_falls_back_when_unset_or_empty():
    agent = _agent(APP_VERSION="")
    assert agent == "CIOOS-CDE-Harvester/dev (+https://github.com/cioos-siooc/explore-cioos)"


@pytest.mark.parametrize("build", [_build_ckan_session, _build_retry_session, _build_session])
def test_sessions_send_the_agent(build):
    assert build().headers["User-Agent"] == USER_AGENT
