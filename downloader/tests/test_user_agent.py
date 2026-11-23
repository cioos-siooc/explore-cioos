import os
import subprocess
import sys


def _agent(**env):
    clean = {k: v for k, v in os.environ.items() if k not in ("APP_URL", "APP_VERSION")}
    return subprocess.run(
        [sys.executable, "-c", "from cioos_downloader.formats import REQUEST_HEADERS as h; print(h['User-Agent'])"],
        env=clean | env, capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_agent_names_the_deployment_and_build():
    agent = _agent(APP_URL="https://explore.example.ca", APP_VERSION="abc123")
    assert agent == "CIOOS-CDE-Downloader/abc123 (+https://explore.example.ca)"


def test_reproduce_run_without_compose_env_falls_back():
    assert _agent() == "CIOOS-CDE-Downloader/dev (+https://github.com/cioos-siooc/explore-cioos)"
